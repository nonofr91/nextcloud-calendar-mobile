package expo.modules.ncmcar

import android.os.Handler
import android.os.Looper
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.constraints.ConstraintManager
import androidx.car.app.model.Action
import androidx.car.app.model.CarColor
import androidx.car.app.model.CarIcon
import androidx.car.app.model.ItemList
import androidx.car.app.model.ListTemplate
import androidx.car.app.model.ParkedOnlyOnClickListener
import androidx.car.app.model.Row
import androidx.car.app.model.SectionedItemList
import androidx.car.app.model.Template
import androidx.car.app.versioning.CarAppApiLevels
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner

class AgendaScreen(carContext: CarContext) : Screen(carContext) {

  private val handler = Handler(Looper.getMainLooper())

  // Re-render once a minute so the "Dans N min" countdown stays truthful.
  private val ticker = object : Runnable {
    override fun run() {
      invalidate()
      handler.postDelayed(this, REFRESH_MS)
    }
  }

  init {
    CarAgendaStore.load(carContext)
    CarAgendaStore.onChanged = { invalidate() }
    lifecycle.addObserver(object : DefaultLifecycleObserver {
      override fun onCreate(owner: LifecycleOwner) {
        handler.postDelayed(ticker, REFRESH_MS)
      }
      override fun onDestroy(owner: LifecycleOwner) { handler.removeCallbacks(ticker) }
    })
  }

  override fun onGetTemplate(): Template {
    val builder = ListTemplate.Builder().setTitle("Agenda")

    val items = CarAgendaStore.items
    if (items.isEmpty()) {
      val message = if (CarAgendaStore.everSynced(carContext)) {
        "Aucun événement à venir"
      } else {
        "Ouvrez l'application sur le téléphone pour synchroniser"
      }
      val empty = ItemList.Builder().setNoItemsMessage(message).build()
      return builder.setSingleList(empty).build()
    }

    // The host decides how many rows are safe to show (driving vs parked).
    val listLimit = carContext.getCarService(ConstraintManager::class.java)
      .getContentLimit(ConstraintManager.CONTENT_LIMIT_TYPE_LIST)
    var budget = listLimit

    // Voice summary as a FAB when the API level allows it, else a normal row.
    if (carContext.carAppApiLevel >= CarAppApiLevels.LEVEL_6) {
      builder.addAction(
        Action.Builder()
          .setIcon(
            CarIcon.Builder(
              androidx.core.graphics.drawable.IconCompat.createWithResource(
                carContext, R.drawable.ic_mic_24
              )
            ).build()
          )
          .setOnClickListener { speakAgenda() }
          .setBackgroundColor(CarColor.BLUE)
          .build()
      )
    }

    // "Next up" card — the one glance that matters while driving.
    val next = items.first()
    val nextRow = Row.Builder()
      .setTitle(next.title)
      .addText(listOf(startsInText(next), next.location).filter { it.isNotEmpty() }.joinToString("  ·  "))
      .setBrowsable(true)
      .setOnClickListener(ParkedOnlyOnClickListener.create {
        screenManager.push(EventDetailScreen(carContext, 0))
      })
      .build()
    builder.addSectionedList(
      SectionedItemList.create(ItemList.Builder().addItem(nextRow).build(), "Prochain rendez-vous")
    )
    budget -= 1

    // Map entry — pins of today's geolocated events, rendered by the host.
    val geoCount = items.count { it.geoLat != null && it.geoLon != null }
    if (geoCount > 0 && budget > 0) {
      val mapRow = Row.Builder()
        .setTitle("Voir sur la carte")
        .addText("$geoCount ${if (geoCount == 1) "lieu" else "lieux"}")
        .setBrowsable(true)
        .setOnClickListener { screenManager.push(MapScreen(carContext)) }
        .build()
      builder.addSectionedList(
        SectionedItemList.create(ItemList.Builder().addItem(mapRow).build(), "Carte")
      )
      budget -= 1
    }

    // FAB fallback: the voice trigger as a row when addAction isn't available.
    if (carContext.carAppApiLevel < CarAppApiLevels.LEVEL_6 && budget > 0) {
      val speakRow = Row.Builder()
        .setTitle("Lire l'agenda à voix haute")
        .setImage(
          CarIcon.Builder(
            androidx.core.graphics.drawable.IconCompat.createWithResource(
              carContext, R.drawable.ic_mic_24
            )
          ).build()
        )
        .setBrowsable(true)
        .setOnClickListener(ParkedOnlyOnClickListener.create { speakAgenda() })
        .build()
      builder.addSectionedList(
        SectionedItemList.create(ItemList.Builder().addItem(speakRow).build(), "Assistant")
      )
      budget -= 1
    }

    // Group consecutive items by day — items arrive sorted by start time.
    var sectionItems = ItemList.Builder()
    var currentDay = ""
    var shown = 0
    for ((index, item) in items.withIndex()) {
      if (shown >= budget) break
      if (item.dayKey != currentDay) {
        if (currentDay.isNotEmpty()) {
          builder.addSectionedList(
            SectionedItemList.create(sectionItems.build(), items[index - 1].dayLabel)
          )
        }
        sectionItems = ItemList.Builder()
        currentDay = item.dayKey
      }
      sectionItems.addItem(buildRow(item, index))
      shown += 1
    }
    if (shown > 0) {
      builder.addSectionedList(
        SectionedItemList.create(sectionItems.build(), items[shown - 1].dayLabel)
      )
    }
    return builder.build()
  }

  private fun buildRow(item: CarAgendaStore.Item, index: Int): Row {
    val meta = listOf(item.timeText, item.calName, item.accountName)
      .filter { it.isNotEmpty() }
      .joinToString("  ·  ")
    return Row.Builder()
      .setTitle(item.title)
      .addText(meta)
      .setBrowsable(true)
      .setOnClickListener(
        ParkedOnlyOnClickListener.create {
          screenManager.push(EventDetailScreen(carContext, index))
        }
      )
      .build()
  }

  /** "En cours" / "Dans 25 min" / "Dans 3 h" for the next-up card. */
  private fun startsInText(item: CarAgendaStore.Item): String {
    if (item.allDay) return item.dayLabel
    val now = System.currentTimeMillis()
    if (now >= item.startTs) return "En cours"
    val min = (item.startTs - now) / 60_000
    return if (min >= 90) "Dans ${min / 60} h ${min % 60} min" else "Dans $min min"
  }

  /** Speaks the next few events — eyes-free summary, safe while driving. */
  private fun speakAgenda() {
    val items = CarAgendaStore.items.take(SPEAK_MAX)
    val text = if (items.isEmpty()) {
      "Aucun événement à venir."
    } else {
      buildString {
        append(items.size).append(if (items.size == 1) " événement à venir. " else " événements à venir. ")
        items.forEach { append(it.dayLabel).append(" ").append(it.timeText).append(" : ").append(it.title).append(". ") }
      }
    }
    AgendaSpeaker.speak(carContext, text)
  }

  companion object {
    private const val SPEAK_MAX = 4
    private const val REFRESH_MS = 60_000L
  }
}

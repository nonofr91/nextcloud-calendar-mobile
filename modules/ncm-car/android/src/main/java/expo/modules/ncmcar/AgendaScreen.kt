package expo.modules.ncmcar

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.CarIcon
import androidx.car.app.model.ItemList
import androidx.car.app.model.ListTemplate
import androidx.car.app.model.ParkedOnlyOnClickListener
import androidx.car.app.model.Row
import androidx.car.app.model.SectionedItemList
import androidx.car.app.model.Template

class AgendaScreen(carContext: CarContext) : Screen(carContext) {

  init {
    CarAgendaStore.onChanged = { invalidate() }
  }

  override fun onGetTemplate(): Template {
    val builder = ListTemplate.Builder().setTitle("Agenda")

    // Header actions can't hold a custom click listener — the voice trigger
    // lives as a normal browsable row instead.
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

    val items = CarAgendaStore.items
    if (items.isEmpty()) {
      val empty = ItemList.Builder().setNoItemsMessage("Aucun événement à venir").build()
      return builder.addSectionedList(SectionedItemList.create(empty, "Prochains")).build()
    }

    // Group consecutive items by day — items arrive sorted by start time.
    var sectionItems = ItemList.Builder()
    var currentDay = ""
    for ((index, item) in items.withIndex()) {
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
    }
    builder.addSectionedList(
      SectionedItemList.create(sectionItems.build(), items.last().dayLabel)
    )
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
  }
}

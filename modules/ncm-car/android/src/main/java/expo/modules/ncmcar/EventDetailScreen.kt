package expo.modules.ncmcar

import android.content.Intent
import android.net.Uri
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.constraints.ConstraintManager
import androidx.car.app.model.Action
import androidx.car.app.model.ActionStrip
import androidx.car.app.model.Pane
import androidx.car.app.model.PaneTemplate
import androidx.car.app.model.ParkedOnlyOnClickListener
import androidx.car.app.model.Row
import androidx.car.app.model.Template

/** Read-only event detail, pushed when a browsable agenda row is tapped while parked. */
class EventDetailScreen(carContext: CarContext, private val index: Int) : Screen(carContext) {

  override fun onGetTemplate(): Template {
    val item = CarAgendaStore.items.getOrNull(index)
      ?: return PaneTemplate.Builder(
        Pane.Builder().addRow(Row.Builder().setTitle("Événement introuvable").build()).build()
      ).setTitle("Agenda").setHeaderAction(Action.BACK).build()

    // Pane rows are host-capped (usually 4) — order by driving relevance.
    val paneLimit = carContext.getCarService(ConstraintManager::class.java)
      .getContentLimit(ConstraintManager.CONTENT_LIMIT_TYPE_PANE)
    val rows = mutableListOf(
      Row.Builder().setTitle("Quand").addText("${item.dayLabel} · ${item.timeText}").build()
    )
    if (item.location.isNotEmpty()) {
      rows += Row.Builder().setTitle("Où").addText(item.location).build()
    }
    if (item.departTs > 0) {
      val depart = java.text.SimpleDateFormat("HH:mm", java.util.Locale.getDefault())
        .format(java.util.Date(item.departTs))
      rows += Row.Builder().setTitle("Départ").addText(depart).build()
    }
    val cal = listOf(item.calName, item.accountName).filter { it.isNotEmpty() }
      .joinToString("  ·  ")
    if (cal.isNotEmpty()) {
      rows += Row.Builder().setTitle("Calendrier").addText(cal).build()
    }
    if (item.description.isNotEmpty()) {
      rows += Row.Builder().setTitle("Note").addText(item.description).build()
    }
    val pane = Pane.Builder().apply {
      rows.take(paneLimit).forEach(::addRow)
    }.build()

    val actions = mutableListOf<Action>()
    if (item.geoLat != null && item.geoLon != null) {
      actions += navAction("geo:${item.geoLat},${item.geoLon}")
    } else if (item.location.isNotEmpty()) {
      actions += navAction("geo:0,0?q=${Uri.encode(item.location)}")
    }
    // The strip allows a single custom-titled action — "Rejoindre" is icon-only.
    if (item.talkUrl.isNotEmpty()) {
      actions += Action.Builder()
        .setIcon(
          androidx.car.app.model.CarIcon.Builder(
            androidx.core.graphics.drawable.IconCompat.createWithResource(
              carContext, R.drawable.ic_videocam_24
            )
          ).build()
        )
        .setOnClickListener(
          ParkedOnlyOnClickListener.create {
            carContext.startActivity(
              Intent(Intent.ACTION_VIEW, Uri.parse(item.talkUrl))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
          }
        )
        .build()
    }

    return PaneTemplate.Builder(pane)
      .setTitle(item.title)
      .setHeaderAction(Action.BACK)
      .apply {
        if (actions.isNotEmpty()) {
          setActionStrip(ActionStrip.Builder().apply { actions.forEach(::addAction) }.build())
        }
      }
      .build()
  }

  private fun navAction(uri: String) = Action.Builder()
    .setTitle("Naviguer")
    .setOnClickListener {
      carContext.startCarApp(Intent(CarContext.ACTION_NAVIGATE, Uri.parse(uri)))
    }
    .build()
}

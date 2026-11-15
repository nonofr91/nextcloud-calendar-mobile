package expo.modules.ncmcar

import android.content.Intent
import android.net.Uri
import androidx.car.app.CarContext
import androidx.car.app.Screen
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

    val pane = Pane.Builder()
      .addRow(Row.Builder().setTitle(item.dayLabel).addText(item.timeText).build())
      .apply {
        val cal = listOf(item.calName, item.accountName).filter { it.isNotEmpty() }
          .joinToString("  ·  ")
        if (cal.isNotEmpty()) {
          addRow(Row.Builder().setTitle("Calendrier").addText(cal).build())
        }
        if (item.location.isNotEmpty()) {
          addRow(Row.Builder().setTitle("Lieu").addText(item.location).build())
        }
        if (item.description.isNotEmpty()) {
          addRow(Row.Builder().setTitle("Notes").addText(item.description).build())
        }
      }
      .build()

    val actions = mutableListOf<Action>()
    if (item.geoLat != null && item.geoLon != null) {
      actions += navAction("geo:${item.geoLat},${item.geoLon}")
    } else if (item.location.isNotEmpty()) {
      actions += navAction("geo:0,0?q=${Uri.encode(item.location)}")
    }
    if (item.talkUrl.isNotEmpty()) {
      actions += Action.Builder()
        .setTitle("Rejoindre")
        .setOnClickListener(
          ParkedOnlyOnClickListener.create {
            carContext.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(item.talkUrl)))
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

package expo.modules.ncmcar

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.constraints.ConstraintManager
import androidx.car.app.model.Action
import androidx.car.app.model.CarLocation
import androidx.car.app.model.ItemList
import androidx.car.app.model.Metadata
import androidx.car.app.model.ParkedOnlyOnClickListener
import androidx.car.app.model.Place
import androidx.car.app.model.PlaceListMapTemplate
import androidx.car.app.model.PlaceMarker
import androidx.car.app.model.Row
import androidx.car.app.model.Template

/**
 * Host-rendered map with one pin per geolocated event — "where am I going
 * today" at a glance. Navigation itself is never done here; rows open the
 * read-only detail screen which hands off to the vehicle nav app.
 */
class MapScreen(carContext: CarContext) : Screen(carContext) {

  override fun onGetTemplate(): Template {
    val listLimit = carContext.getCarService(ConstraintManager::class.java)
      .getContentLimit(ConstraintManager.CONTENT_LIMIT_TYPE_LIST)

    val itemList = ItemList.Builder().apply {
      var pin = 0
      CarAgendaStore.items.forEachIndexed { index, item ->
        val lat = item.geoLat ?: return@forEachIndexed
        val lon = item.geoLon ?: return@forEachIndexed
        if (pin >= listLimit) return@forEachIndexed
        pin += 1
        val place = Place.Builder(CarLocation.create(lat, lon))
          .setMarker(PlaceMarker.Builder().setLabel(pin.toString()).build())
          .build()
        addItem(
          Row.Builder()
            .setTitle(item.title)
            .addText(
              listOf(item.timeText, item.location)
                .filter { it.isNotEmpty() }
                .joinToString("  ·  ")
            )
            .setMetadata(Metadata.Builder().setPlace(place).build())
            .setBrowsable(true)
            .setOnClickListener(
              ParkedOnlyOnClickListener.create {
                screenManager.push(EventDetailScreen(carContext, index))
              }
            )
            .build()
        )
      }
      setNoItemsMessage("Aucun événement géolocalisé")
    }.build()

    return PlaceListMapTemplate.Builder()
      .setTitle("Agenda — carte")
      .setHeaderAction(Action.BACK)
      .setItemList(itemList)
      .build()
  }
}

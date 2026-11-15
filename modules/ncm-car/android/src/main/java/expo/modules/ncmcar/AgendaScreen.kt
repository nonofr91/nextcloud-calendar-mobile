package expo.modules.ncmcar

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.ItemList
import androidx.car.app.model.ListTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template

class AgendaScreen(carContext: CarContext) : Screen(carContext) {

  init {
    CarAgendaStore.onChanged = { invalidate() }
  }

  override fun onGetTemplate(): Template {
    val list = ItemList.Builder()
    CarAgendaStore.items.take(MAX_ROWS).forEach { item ->
      val row = Row.Builder()
        .setTitle(item.title)
        .addText("${item.meta}  ·  ${item.subtitle}")
        .setBrowsable(false)
        .build()
      list.addItem(row)
    }
    return ListTemplate.Builder()
      .setSingleList(
        list.setNoItemsMessage("Aucun événement à venir").build()
      )
      .setTitle("Agenda")
      .setHeaderAction(Action.APP_ICON)
      .build()
  }

  companion object {
    private const val MAX_ROWS = 6
  }
}

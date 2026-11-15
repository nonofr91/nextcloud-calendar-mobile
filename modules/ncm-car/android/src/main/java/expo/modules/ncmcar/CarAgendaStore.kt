package expo.modules.ncmcar

import org.json.JSONArray

/** In-memory agenda snapshot pushed from JS; the car screen reads it on invalidate(). */
object CarAgendaStore {
  data class Item(val title: String, val subtitle: String, val meta: String)

  @Volatile var items: List<Item> = emptyList()
    private set

  @Volatile var onChanged: (() -> Unit)? = null

  fun setJson(json: String) {
    val arr = JSONArray(json)
    val out = ArrayList<Item>(arr.length())
    for (i in 0 until arr.length()) {
      val o = arr.getJSONObject(i)
      out.add(
        Item(
          title = o.optString("title"),
          subtitle = o.optString("subtitle"),
          meta = o.optString("meta"),
        )
      )
    }
    items = out
    onChanged?.invoke()
  }
}

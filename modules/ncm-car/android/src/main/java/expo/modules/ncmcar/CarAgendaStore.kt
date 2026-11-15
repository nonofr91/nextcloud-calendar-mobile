package expo.modules.ncmcar

import org.json.JSONArray

/** In-memory agenda snapshot pushed from JS; the car screen reads it on invalidate(). */
object CarAgendaStore {
  data class Item(
    val title: String,
    val dayKey: String,
    val dayLabel: String,
    val timeText: String,
    val calName: String,
    val accountName: String,
    val location: String,
    val description: String,
    val geoLat: Double?,
    val geoLon: Double?,
    val talkUrl: String,
  )

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
          dayKey = o.optString("dayKey"),
          dayLabel = o.optString("dayLabel"),
          timeText = o.optString("timeText"),
          calName = o.optString("calName"),
          accountName = o.optString("accountName"),
          location = o.optString("location"),
          description = o.optString("description"),
          geoLat = if (o.isNull("geoLat")) null else o.optDouble("geoLat"),
          geoLon = if (o.isNull("geoLon")) null else o.optDouble("geoLon"),
          talkUrl = o.optString("talkUrl"),
        )
      )
    }
    items = out
    onChanged?.invoke()
  }
}

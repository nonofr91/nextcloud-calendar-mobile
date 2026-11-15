package expo.modules.ncmcar

import android.content.Context
import org.json.JSONArray

/**
 * Agenda snapshot pushed from JS; the car screen reads it on invalidate().
 * Also persisted to SharedPreferences so the car surface still shows the last
 * known agenda when the RN app has not run since boot (offline/parked).
 */
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
    val startTs: Long,
    val endTs: Long,
    val allDay: Boolean,
  )

  @Volatile var items: List<Item> = emptyList()
    private set

  @Volatile var onChanged: (() -> Unit)? = null

  fun setJson(context: Context, json: String) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit().putString(KEY_JSON, json).putBoolean(KEY_SYNCED, true).apply()
    items = parse(json)
    onChanged?.invoke()
  }

  /** True once the app has pushed an agenda at least once on this install. */
  fun everSynced(context: Context) =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getBoolean(KEY_SYNCED, false)

  /** Loads the last pushed agenda, dropping events that already ended. */
  fun load(context: Context) {
    if (items.isNotEmpty()) return
    val json = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getString(KEY_JSON, null) ?: return
    items = parse(json).filter { it.endTs >= System.currentTimeMillis() }
  }

  private fun parse(json: String): List<Item> {
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
          startTs = o.optLong("startTs"),
          endTs = o.optLong("endTs"),
          allDay = o.optBoolean("allDay"),
        )
      )
    }
    return out
  }

  private const val PREFS = "ncm_car"
  private const val KEY_JSON = "agenda_json"
  private const val KEY_SYNCED = "agenda_synced"
}

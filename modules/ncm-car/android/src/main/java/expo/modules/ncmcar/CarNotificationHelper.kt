package expo.modules.ncmcar

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.car.app.notification.CarAppExtender
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject

object CarNotificationHelper {
  private const val CHANNEL_ID = "ncm-car-reminders"

  fun ensureChannel(context: Context) {
    val mgr = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (mgr.getNotificationChannel(CHANNEL_ID) == null) {
      mgr.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Rappels calendrier", NotificationManager.IMPORTANCE_HIGH)
      )
    }
  }

  fun notify(context: Context, json: String) {
    ensureChannel(context)
    val o = JSONObject(json)
    val notifId = o.optInt("notifId", o.optString("title").hashCode())

    // Tap on the notification body opens the car agenda surface.
    val contentIntent = PendingIntent.getActivity(
      context,
      notifId,
      context.packageManager.getLaunchIntentForPackage(context.packageName)
        ?.setClassName(context.packageName, "androidx.car.app.activity.CarAppActivity"),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    val builder = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_event_24)
      .setContentTitle(o.optString("title"))
      .setContentText(o.optString("text"))
      .setCategory(NotificationCompat.CATEGORY_EVENT)
      .extend(CarAppExtender.Builder().setContentIntent(contentIntent).build())
      .addAction(
        R.drawable.ic_mic_24, "Lire",
        broadcast(context, CarActionReceiver.ACTION_SPEAK, notifId) {
          putExtra(CarActionReceiver.EXTRA_SPEAK_TEXT, o.optString("speakText"))
        }
      )

    val geoUri = o.optString("geoUri")
    if (geoUri.isNotEmpty()) {
      // Navigation goes straight to the nav app via an activity PendingIntent —
      // a broadcast receiver could not start an activity from the background.
      val navIntent = PendingIntent.getActivity(
        context,
        notifId xor 0x4e4156, // "NAV"
        Intent(Intent.ACTION_VIEW, android.net.Uri.parse(geoUri))
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )
      builder.addAction(R.drawable.ic_event_24, "Naviguer", navIntent)
    }

    NotificationManagerCompat.from(context).notify(notifId, builder.build())
  }

  private fun broadcast(
    context: Context,
    action: String,
    notifId: Int,
    fill: Intent.() -> Unit,
  ): PendingIntent {
    val intent = Intent(context, CarActionReceiver::class.java)
      .setAction(action)
      .putExtra(CarActionReceiver.EXTRA_NOTIF_ID, notifId)
      .apply(fill)
    return PendingIntent.getBroadcast(
      context,
      action.hashCode() xor notifId,
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }
}

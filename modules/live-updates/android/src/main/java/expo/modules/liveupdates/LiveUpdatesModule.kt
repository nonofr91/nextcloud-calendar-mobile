package expo.modules.liveupdates

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.Manifest
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.app.NotificationManagerCompat
import expo.modules.interfaces.permissions.Permissions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

private const val CHANNEL_ID = "live_event"
private const val NOTIFICATION_ID = 4201

private const val LIVE_UPDATES_API = 36

private const val REFRESH_MS = 30_000L

class LiveEventRecord : Record {
  @Field val title: String = ""
  @Field val textTemplate: String = ""
  @Field val shortTemplate: String = ""
  @Field val hourUnit: String = "h"
  @Field val minuteUnit: String = "m"

  @Field val location: String = ""
  @Field val attendees: List<String> = emptyList()
  @Field val startMs: Double = 0.0
  @Field val endMs: Double = 0.0
  @Field val color: Int? = null
}

class LiveUpdatesModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context is not available" }

  private val notificationManager: NotificationManager
    get() = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  override fun definition() = ModuleDefinition {
    Name("LiveUpdates")

    Function("isSupported") {
      NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    Function("canPromote") {
      Build.VERSION.SDK_INT >= LIVE_UPDATES_API && notificationManager.canPostPromotedNotifications()
    }

    Function("hasPermission") {
      NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    Function("isPromoted") {
      if (Build.VERSION.SDK_INT < LIVE_UPDATES_API) return@Function false
      notificationManager.activeNotifications
        .firstOrNull { it.id == NOTIFICATION_ID }
        ?.notification
        ?.let { it.flags and Notification.FLAG_PROMOTED_ONGOING != 0 }
        ?: false
    }

    AsyncFunction("requestPermission") { promise: Promise ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
        promise.resolve(NotificationManagerCompat.from(context).areNotificationsEnabled())
        return@AsyncFunction
      }
      Permissions.askForPermissionsWithPermissionsManager(
        appContext.permissions,
        promise,
        Manifest.permission.POST_NOTIFICATIONS,
      )
    }

    AsyncFunction("update") { event: LiveEventRecord ->
      current = event
      if (hasEnded(event)) {
        dismiss()
        return@AsyncFunction
      }
      ensureChannel()
      post(event)
      scheduleRefresh()
    }

    AsyncFunction("clear") {
      dismiss()
    }

    OnDestroy {
      stopRefresh()
    }
  }

  private var current: LiveEventRecord? = null
  private val handler = Handler(Looper.getMainLooper())

  private val refresh = object : Runnable {
    override fun run() {
      val event = current ?: return
      if (hasEnded(event)) {
        dismiss()
        return
      }
      post(event)
      scheduleRefresh()
    }
  }

  private fun hasEnded(event: LiveEventRecord): Boolean =
    System.currentTimeMillis() >= event.endMs

  private fun scheduleRefresh() {
    val event = current ?: return
    handler.removeCallbacks(refresh)
    val untilEnd = event.endMs.toLong() - System.currentTimeMillis()
    if (untilEnd <= 0) {
      dismiss()
      return
    }
    handler.postDelayed(refresh, minOf(REFRESH_MS, untilEnd))
  }

  private fun dismiss() {
    stopRefresh()
    current = null
    notificationManager.cancel(NOTIFICATION_ID)
  }

  private fun stopRefresh() {
    handler.removeCallbacks(refresh)
  }

  private fun post(event: LiveEventRecord) {
    notificationManager.notify(NOTIFICATION_ID, buildNotification(event))
  }

  private fun remainingMinutes(event: LiveEventRecord): Int {
    val left = event.endMs - System.currentTimeMillis()
    return if (left <= 0) 0 else Math.ceil(left / 60_000.0).toInt()
  }

  private fun formatRemaining(event: LiveEventRecord, minutes: Int): String {
    val total = maxOf(0, minutes)
    val hours = total / 60
    val mins = total % 60
    return when {
      hours == 0 -> "$mins${event.minuteUnit}"
      mins == 0 -> "$hours${event.hourUnit}"
      else -> "$hours${event.hourUnit}${mins.toString().padStart(2, '0')}"
    }
  }

  private fun interpolate(template: String, event: LiveEventRecord, minutes: Int): String =
    template.replace("{{duration}}", formatRemaining(event, minutes))

  private fun details(event: LiveEventRecord, remaining: Int): String {
    val lines = mutableListOf(interpolate(event.textTemplate, event, remaining))
    if (event.location.isNotBlank()) lines.add(event.location)
    if (event.attendees.isNotEmpty()) lines.add(event.attendees.joinToString(", "))
    return if (lines.size > 1) lines.joinToString("\n") else ""
  }

  private fun progressOf(event: LiveEventRecord): Int {
    val start = event.startMs
    val end = event.endMs
    if (end <= start) return 100
    val ratio = (System.currentTimeMillis() - start) / (end - start)
    return (ratio * 100).toInt().coerceIn(0, 100)
  }

  private fun ensureChannel() {
    val channel = NotificationChannel(
      CHANNEL_ID,
      "Ongoing event",
      NotificationManager.IMPORTANCE_DEFAULT,
    ).apply {
      setShowBadge(false)
      enableVibration(false)
      setSound(null, null)
    }
    notificationManager.createNotificationChannel(channel)
  }

  private fun launchIntent(): PendingIntent? {
    val intent = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
    return PendingIntent.getActivity(
      context,
      0,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun requestPromotion(builder: Notification.Builder) {
    runCatching {
      Notification.Builder::class.java
        .getMethod("setRequestPromotedOngoing", Boolean::class.javaPrimitiveType)
        .invoke(builder, true)
    }
  }

  private fun buildNotification(event: LiveEventRecord): Notification {
    val remaining = remainingMinutes(event)

    val builder = Notification.Builder(context, CHANNEL_ID)
      .setSmallIcon(context.applicationInfo.icon)
      .setContentTitle(event.title)
      .setContentText(interpolate(event.textTemplate, event, remaining))
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setContentIntent(launchIntent())
      .setShowWhen(false)
      .setTimeoutAfter(maxOf(1L, event.endMs.toLong() - System.currentTimeMillis()))

    event.color?.let { builder.setColor(it) }
    builder.setProgress(100, progressOf(event), false)

    val details = details(event, remaining)
    if (details.isNotEmpty()) {
      builder.setStyle(Notification.BigTextStyle().bigText(details))
      builder.setVisibility(Notification.VISIBILITY_PRIVATE)
    }

    if (Build.VERSION.SDK_INT >= LIVE_UPDATES_API) {
      builder.setShortCriticalText(interpolate(event.shortTemplate, event, remaining))
      requestPromotion(builder)
    }

    return builder.build()
  }
}

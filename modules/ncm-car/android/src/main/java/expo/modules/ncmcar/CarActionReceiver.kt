package expo.modules.ncmcar

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationManagerCompat

/** Handles car-notification action taps: read aloud (TTS) and navigate. */
class CarActionReceiver : BroadcastReceiver() {

  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      ACTION_SPEAK -> {
        intent.getStringExtra(EXTRA_SPEAK_TEXT)?.let { AgendaSpeaker.speak(context, it) }
      }
    }
    NotificationManagerCompat.from(context).cancel(intent.getIntExtra(EXTRA_NOTIF_ID, 0))
  }

  companion object {
    const val ACTION_SPEAK = "expo.modules.ncmcar.action.SPEAK"
    const val EXTRA_SPEAK_TEXT = "speakText"
    const val EXTRA_NOTIF_ID = "notifId"
  }
}

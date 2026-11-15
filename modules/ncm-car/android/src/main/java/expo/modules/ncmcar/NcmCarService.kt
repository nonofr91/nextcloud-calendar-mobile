package expo.modules.ncmcar

import android.content.Intent
import android.speech.tts.TextToSpeech
import androidx.car.app.CarAppService
import androidx.car.app.Screen
import androidx.car.app.Session
import androidx.car.app.validation.HostValidator
import java.util.Locale

class NcmCarService : CarAppService() {
  override fun createHostValidator(): HostValidator = HostValidator.ALLOW_ALL_HOSTS_VALIDATOR

  override fun onCreateSession(): Session = AgendaSession()

  override fun onDestroy() {
    AgendaSpeaker.shutdown()
    super.onDestroy()
  }
}

class AgendaSession : Session() {
  override fun onCreateScreen(intent: Intent): Screen = AgendaScreen(carContext)
}

/** Lazily-initialized TTS engine owned by the car session lifecycle. */
object AgendaSpeaker {
  private var tts: TextToSpeech? = null
  private var pending: String? = null

  fun speak(context: android.content.Context, text: String) {
    val engine = tts
    if (engine == null) {
      pending = text
      tts = TextToSpeech(context.applicationContext) { status ->
        if (status == TextToSpeech.SUCCESS) {
          tts?.language = Locale.getDefault()
          pending?.let { tts?.speak(it, TextToSpeech.QUEUE_FLUSH, null, "agenda") }
          pending = null
        }
      }
    } else {
      engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, "agenda")
    }
  }

  fun shutdown() {
    tts?.stop()
    tts?.shutdown()
    tts = null
    pending = null
  }
}

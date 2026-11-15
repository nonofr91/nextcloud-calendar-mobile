package expo.modules.ncmcar

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.car.app.CarContext
import androidx.car.app.CarToast
import java.util.Calendar

/**
 * In-car voice query: SpeechRecognizer → intent match → TTS answer.
 * Recognizer is created per question and always destroyed on end/error.
 */
object VoiceQueryHelper {

  /** True when the mic can be used; otherwise tells the user where to grant it. */
  fun ask(carContext: CarContext) {
    if (carContext.checkSelfPermission(Manifest.permission.RECORD_AUDIO)
      != PackageManager.PERMISSION_GRANTED
    ) {
      CarToast.makeText(
        carContext,
        "Micro non autorisé — ouvrez les réglages de l'app sur le téléphone",
        CarToast.LENGTH_LONG
      ).show()
      return
    }
    if (!SpeechRecognizer.isRecognitionAvailable(carContext)) {
      AgendaSpeaker.speak(carContext, "La reconnaissance vocale n'est pas disponible sur ce véhicule.")
      return
    }
    val recognizer = SpeechRecognizer.createSpeechRecognizer(carContext)
    recognizer.setRecognitionListener(object : RecognitionListener {
      override fun onReadyForSpeech(params: Bundle?) {
        CarToast.makeText(carContext, "Parlez…", CarToast.LENGTH_SHORT).show()
      }
      override fun onResults(results: Bundle) {
        recognizer.destroy()
        val query = results
          .getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
          ?.firstOrNull().orEmpty()
        answer(carContext, query)
      }
      override fun onError(error: Int) {
        recognizer.destroy()
        AgendaSpeaker.speak(
          carContext,
          "Je n'ai pas compris. Demandez par exemple : qu'est-ce que j'ai demain ?"
        )
      }
      override fun onBeginningOfSpeech() {}
      override fun onRmsChanged(rmsdB: Float) {}
      override fun onBufferReceived(buffer: ByteArray?) {}
      override fun onEndOfSpeech() {}
      override fun onPartialResults(partialResults: Bundle?) {}
      override fun onEvent(eventType: Int, params: Bundle?) {}
    })
    recognizer.startListening(
      Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
        .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
        // Bounded listen: end ~1.5 s after the user stops talking.
        .putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1500L)
        .putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 1500L)
        .putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 800L)
    )
  }

  /** Answers a query text directly — used by the recognizer and the QUERY broadcast. */
  fun answer(context: android.content.Context, query: String) {
    AgendaSpeaker.speak(context, buildAnswer(query, CarAgendaStore.items))
  }

  /** Maps the spoken question to the agenda slice to read. */
  internal fun buildAnswer(query: String, items: List<CarAgendaStore.Item>): String {
    if (items.isEmpty()) return "Aucun événement à venir."
    val q = query.lowercase()
    val today = dayKey(0)
    val tomorrow = dayKey(1)
    val slice = when {
      q.contains("demain") -> items.filter { it.dayKey == tomorrow }
        .ifEmpty { return "Rien de prévu demain." }
      q.contains("aujourd") || q.contains("ce soir") || q.contains("ce matin") ->
        items.filter { it.dayKey == today }
          .ifEmpty { return "Plus rien de prévu aujourd'hui." }
      q.contains("prochain") || q.contains("suivant") -> items.take(1)
      else -> items.take(SPEAK_MAX) // "semaine", "agenda", anything else → global read
    }
    return buildString {
      append(slice.size)
        .append(if (slice.size == 1) " événement. " else " événements. ")
      slice.forEach {
        append(it.dayLabel).append(" ").append(it.timeText).append(" : ")
          .append(it.title).append(". ")
        if (it.location.isNotEmpty()) append("Lieu : ").append(it.location).append(". ")
      }
    }
  }

  private fun dayKey(offsetDays: Int): String {
    val c = Calendar.getInstance()
    c.add(Calendar.DAY_OF_YEAR, offsetDays)
    return "%04d-%02d-%02d".format(c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH))
  }

  private const val SPEAK_MAX = 4
}

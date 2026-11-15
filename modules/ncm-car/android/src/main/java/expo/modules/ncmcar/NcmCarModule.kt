package expo.modules.ncmcar

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class NcmCarModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NcmCar")

    Function("setAgenda") { json: String ->
      try {
        appContext.reactContext?.let { CarAgendaStore.setJson(it, json) } != null
      } catch (e: Exception) {
        false
      }
    }

    Function("notifyUpcoming") { json: String ->
      try {
        appContext.reactContext?.let { CarNotificationHelper.notify(it, json) } != null
      } catch (e: Exception) {
        false
      }
    }
  }
}

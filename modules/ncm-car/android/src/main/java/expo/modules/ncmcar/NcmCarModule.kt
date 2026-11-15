package expo.modules.ncmcar

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class NcmCarModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NcmCar")

    Function("setAgenda") { json: String ->
      try {
        CarAgendaStore.setJson(json)
        true
      } catch (e: Exception) {
        false
      }
    }
  }
}

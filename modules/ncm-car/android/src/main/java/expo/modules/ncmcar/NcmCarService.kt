package expo.modules.ncmcar

import android.content.Intent
import androidx.car.app.CarAppService
import androidx.car.app.Screen
import androidx.car.app.Session
import androidx.car.app.validation.HostValidator

class NcmCarService : CarAppService() {
  override fun createHostValidator(): HostValidator = HostValidator.ALLOW_ALL_HOSTS_VALIDATOR

  override fun onCreateSession(): Session = AgendaSession()
}

class AgendaSession : Session() {
  override fun onCreateScreen(intent: Intent): Screen = AgendaScreen(carContext)
}

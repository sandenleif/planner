package de.leifsanden.planner.widget

import android.content.Context
import android.graphics.Color
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

/**
 * Der Ablageort zwischen App und Widget.
 *
 * Das Widget wird vom Launcher gezeichnet, aber die Daten dafuer sammelt der
 * App-Prozess ein: sowohl der AppWidgetProvider als auch der RemoteViewsService
 * gehoeren zu dieser App. Deshalb reichen normale SharedPreferences - es lesen
 * und schreiben nur Klassen aus einem einzigen Prozess.
 *
 * Gespeichert wird JSON und keine einzelnen Schluessel. Der Schnappschuss ist
 * eine Einheit: eine Zahl "3 faellig" neben einer Liste mit vier Zeilen waere
 * kein halber Fehler, sondern ein ganzer.
 */

data class WidgetLine(
    val title: String,
    val listName: String,
    /** Bereits aufgeloest zu einer ARGB-Farbe. */
    val color: Int,
    /** Fertig formatiert, z. B. "Heute 14:30". Kommt so aus dem Frontend. */
    val due: String,
    val overdue: Boolean,
)

data class WidgetSnapshot(
    val generatedAtMs: Long,
    val dueToday: Int,
    val overdue: Int,
    val lines: List<WidgetLine>,
) {
    companion object {
        /** Vor dem ersten Start der App und nach dem Abmelden. */
        val EMPTY = WidgetSnapshot(0L, 0, 0, emptyList())
    }
}

object WidgetStore {
    private const val TAG = "PlannerWidget"
    private const val PREFS = "planner_widget"
    private const val KEY_SNAPSHOT = "snapshot"

    /** Waldgruen aus src/features/lists/listColors.ts - dieselbe Vorgabe. */
    private const val FALLBACK_COLOR = 0xFF2E6F50.toInt()

    fun save(context: Context, json: String) {
        prefs(context).edit().putString(KEY_SNAPSHOT, json).apply()
    }

    fun load(context: Context): WidgetSnapshot {
        val raw = prefs(context).getString(KEY_SNAPSHOT, null) ?: return WidgetSnapshot.EMPTY

        return try {
            parse(JSONObject(raw))
        } catch (error: Exception) {
            // Ein kaputter Eintrag darf das Widget nicht dauerhaft lahmlegen -
            // sonst bliebe es auch nach dem naechsten guten Schnappschuss
            // stehen, weil der Launcher den Absturz als "Widget defekt" merkt.
            Log.w(TAG, "Schnappschuss unlesbar, wird verworfen", error)
            prefs(context).edit().remove(KEY_SNAPSHOT).apply()
            WidgetSnapshot.EMPTY
        }
    }

    private fun parse(json: JSONObject): WidgetSnapshot {
        val tasks: JSONArray = json.optJSONArray("tasks") ?: JSONArray()
        val lines = ArrayList<WidgetLine>(tasks.length())

        for (index in 0 until tasks.length()) {
            val task = tasks.optJSONObject(index) ?: continue
            lines.add(
                WidgetLine(
                    title = task.optString("title"),
                    listName = task.optString("listName"),
                    color = parseColor(task.optString("color")),
                    due = task.optString("due"),
                    overdue = task.optBoolean("overdue", false),
                ),
            )
        }

        return WidgetSnapshot(
            generatedAtMs = json.optLong("generatedAtMs", 0L),
            dueToday = json.optInt("dueToday", 0),
            overdue = json.optInt("overdue", 0),
            lines = lines,
        )
    }

    private fun parseColor(value: String): Int =
        try {
            Color.parseColor(value)
        } catch (_: IllegalArgumentException) {
            FALLBACK_COLOR
        }

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}

package de.leifsanden.planner.widget

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import org.json.JSONArray
import org.json.JSONObject

/**
 * Der einzige Weg von der App ins Widget.
 *
 * Ein Befehl, eine Richtung: Die App schiebt einen fertigen Stand herein, das
 * Widget zeigt ihn. Es gibt bewusst keinen Befehl, der etwas zurueckliest, und
 * keinen, mit dem das Widget in die Daten schreiben koennte. Ein Haken, den man
 * auf dem Homescreen setzt, muesste die App starten, Supabase erreichen und mit
 * Wiederholungsregeln umgehen - im Launcher-Prozess, ohne Netz-Garantie und
 * ohne Oberflaeche fuer Fehler. Das Widget ist deshalb ein Schaufenster.
 */

@InvokeArg
class TaskLineArgs {
    var title: String = ""
    var listName: String = ""
    var color: String = ""
    var due: String = ""
    var overdue: Boolean = false
}

@InvokeArg
class SnapshotArgs {
    var generatedAtMs: Long = 0L
    var dueToday: Int = 0
    var overdue: Int = 0
    var tasks: List<TaskLineArgs> = emptyList()
}

@TauriPlugin
class PlannerWidgetPlugin(private val activity: Activity) : Plugin(activity) {

    @Command
    fun updateSnapshot(invoke: Invoke) {
        val args = invoke.parseArgs(SnapshotArgs::class.java)

        WidgetStore.save(activity, args.toJson().toString())
        PlannerWidgetProvider.refreshAll(activity)

        invoke.resolve()
    }
}

/**
 * Von den geparsten Argumenten zurueck nach JSON.
 *
 * Umstaendlich? Nur auf den ersten Blick. Die Alternative waere, den rohen Text
 * durchzureichen und darauf zu vertrauen, dass darin steht, was drinstehen
 * soll. So durchlaeuft der Stand einmal die typisierten Felder oben - was das
 * Frontend anders benennt, faellt hier auf und nicht erst als leere Zeile auf
 * dem Homescreen.
 */
private fun SnapshotArgs.toJson(): JSONObject {
    val tasks = JSONArray()

    for (line in this.tasks) {
        tasks.put(
            JSONObject()
                .put("title", line.title)
                .put("listName", line.listName)
                .put("color", line.color)
                .put("due", line.due)
                .put("overdue", line.overdue),
        )
    }

    return JSONObject()
        .put("generatedAtMs", generatedAtMs)
        .put("dueToday", dueToday)
        .put("overdue", overdue)
        .put("tasks", tasks)
}

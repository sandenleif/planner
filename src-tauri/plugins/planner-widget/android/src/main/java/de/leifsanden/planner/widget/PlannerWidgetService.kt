package de.leifsanden.planner.widget

import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import androidx.core.content.ContextCompat

/**
 * Fuellt die Liste im Widget.
 *
 * Eine ListView in RemoteViews kann sich ihre Zeilen nicht selbst holen - der
 * Launcher fragt dafuer ueber diesen Dienst zurueck in die App. Er laeuft im
 * App-Prozess, liest also dieselben SharedPreferences wie alles andere hier.
 */
class PlannerWidgetService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory =
        PlannerRemoteViewsFactory(applicationContext)
}

private class PlannerRemoteViewsFactory(
    private val context: Context,
) : RemoteViewsService.RemoteViewsFactory {

    private var lines: List<WidgetLine> = emptyList()

    override fun onCreate() {
        lines = WidgetStore.load(context).lines
    }

    /**
     * Wird nach jedem `notifyAppWidgetViewDataChanged` aufgerufen - und das ist
     * der einzige Moment, in dem hier neu gelesen wird. Die Zeilen in einem
     * Feld zu halten statt sie in getViewAt() zu holen, ist kein
     * Geschwindigkeitstrick: getViewAt() laeuft je Zeile, und ein
     * Schnappschuss, der sich zwischen Zeile 2 und 3 aendert, ergaebe eine
     * Liste, die es nie gab.
     */
    override fun onDataSetChanged() {
        lines = WidgetStore.load(context).lines
    }

    override fun onDestroy() {
        lines = emptyList()
    }

    override fun getCount(): Int = lines.size

    override fun getViewAt(position: Int): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.planner_widget_item)
        val line = lines.getOrNull(position) ?: return views

        views.setTextViewText(R.id.planner_widget_item_title, line.title)
        views.setTextViewText(R.id.planner_widget_item_meta, meta(line))
        views.setInt(R.id.planner_widget_item_dot, "setColorFilter", line.color)

        views.setTextColor(
            R.id.planner_widget_item_meta,
            ContextCompat.getColor(
                context,
                if (line.overdue) R.color.planner_widget_overdue else R.color.planner_widget_muted,
            ),
        )

        // Leer, aber nicht ueberfluessig: ohne ein Fuell-Intent bleibt die Zeile
        // fuer Beruehrungen taub, und die Vorlage aus dem Provider kaeme nie zum
        // Zug. Mitzuteilen gibt es nichts - jede Zeile oeffnet dieselbe App.
        views.setOnClickFillInIntent(R.id.planner_widget_item_root, Intent())

        return views
    }

    private fun meta(line: WidgetLine): String =
        listOf(line.due, line.listName)
            .filter { it.isNotEmpty() }
            .joinToString(" · ")

    override fun getLoadingView(): RemoteViews? = null

    override fun getViewTypeCount(): Int = 1

    override fun getItemId(position: Int): Long = position.toLong()

    override fun hasStableIds(): Boolean = false
}

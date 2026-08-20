package de.leifsanden.planner.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.widget.RemoteViews
import java.util.concurrent.TimeUnit

/**
 * Das Widget selbst: Kopfzeile, Liste, Fusszeile.
 *
 * Gezeichnet wird mit RemoteViews und nicht mit Jetpack Glance, obwohl die
 * README Glance als Weg nannte. Der Grund ist das Bauwerkzeug: Glance ist
 * Compose, und Compose bindet den Kotlin-Compiler an eine passende Version des
 * Compose-Plugins. Diese Bibliothek wird aber in ein Gradle-Projekt gemischt,
 * das `tauri android init` erzeugt und dessen Kotlin-Version sich mit jeder
 * Tauri-Version aendern kann. RemoteViews kostet ein paar Zeilen mehr XML und
 * haengt dafuer an nichts, was beim naechsten Update auseinanderfaellt.
 *
 * Wer spaeter doch auf Glance wechselt: die Datenseite (WidgetStore) bleibt
 * unveraendert, ausgetauscht werden nur diese Klasse und PlannerWidgetService.
 */
class PlannerWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray,
    ) {
        for (appWidgetId in appWidgetIds) {
            render(context, appWidgetManager, appWidgetId)
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)

        if (intent.action == ACTION_REFRESH) {
            refreshAll(context)
        }
    }

    companion object {
        /**
         * Der Aktualisieren-Knopf im Widget. Zeichnet neu, was gespeichert ist -
         * neue Daten kann er nicht holen: dazu muesste die App laufen.
         */
        const val ACTION_REFRESH = "de.leifsanden.planner.widget.REFRESH"

        /** Ab dieser Zeit ohne neuen Stand sagt das Widget, wie alt er ist. */
        private val STALE_AFTER_MS = TimeUnit.HOURS.toMillis(12)

        /**
         * Zeichnet alle aufgesetzten Widgets neu. Von der App aus aufgerufen,
         * sobald sich etwas geaendert hat.
         */
        fun refreshAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context) ?: return
            val ids = manager.getAppWidgetIds(
                ComponentName(context.applicationContext, PlannerWidgetProvider::class.java),
            )

            if (ids.isEmpty()) return

            for (appWidgetId in ids) {
                render(context, manager, appWidgetId)
            }

            // Die Kopfzeile steckt in den RemoteViews oben, die Zeilen liefert
            // der Dienst. Ohne diesen zweiten Anstoss aktualisiert sich die
            // Ueberschrift, waehrend darunter die alte Liste stehen bleibt.
            manager.notifyAppWidgetViewDataChanged(ids, R.id.planner_widget_list)
        }

        private fun render(
            context: Context,
            manager: AppWidgetManager,
            appWidgetId: Int,
        ) {
            val snapshot = WidgetStore.load(context)
            val views = RemoteViews(context.packageName, R.layout.planner_widget)

            views.setTextViewText(R.id.planner_widget_title, headline(context, snapshot))
            views.setTextViewText(R.id.planner_widget_subtitle, subtitle(context, snapshot))

            val serviceIntent = Intent(context.applicationContext, PlannerWidgetService::class.java)
                .apply {
                    putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
                    // Ohne eine eindeutige data-URI halten zwei Widgets desselben
                    // Typs denselben Adapter fuer identisch - das zweite bliebe
                    // leer. Der Extra allein zaehlt fuer diesen Vergleich nicht.
                    data = Uri.parse(toUri(Intent.URI_INTENT_SCHEME))
                }

            @Suppress("DEPRECATION")
            views.setRemoteAdapter(R.id.planner_widget_list, serviceIntent)
            views.setEmptyView(R.id.planner_widget_list, R.id.planner_widget_empty)

            openAppIntent(context, appWidgetId)?.let { open ->
                views.setOnClickPendingIntent(R.id.planner_widget_header, open)
                // Ein Tipp auf eine Zeile oeffnet ebenfalls die App. Zeilen
                // brauchen dafuer eine Vorlage plus ein leeres Fuell-Intent je
                // Zeile (siehe PlannerWidgetService) - ein einzelnes
                // setOnClickPendingIntent auf die Liste greift bei Adaptern nicht.
                views.setPendingIntentTemplate(R.id.planner_widget_list, open)
            }

            views.setOnClickPendingIntent(
                R.id.planner_widget_refresh,
                refreshIntent(context, appWidgetId),
            )

            manager.updateAppWidget(appWidgetId, views)
        }

        private fun headline(context: Context, snapshot: WidgetSnapshot): String =
            if (snapshot.dueToday == 0) {
                context.getString(R.string.planner_widget_nothing_due)
            } else {
                context.resources.getQuantityString(
                    R.plurals.planner_widget_due_today,
                    snapshot.dueToday,
                    snapshot.dueToday,
                )
            }

        private fun subtitle(context: Context, snapshot: WidgetSnapshot): String {
            if (snapshot.generatedAtMs == 0L) {
                return context.getString(R.string.planner_widget_no_data)
            }

            val age = System.currentTimeMillis() - snapshot.generatedAtMs
            if (age > STALE_AFTER_MS) {
                val days = TimeUnit.MILLISECONDS.toDays(age).toInt()
                return if (days >= 1) {
                    context.resources.getQuantityString(
                        R.plurals.planner_widget_stale_days,
                        days,
                        days,
                    )
                } else {
                    context.getString(R.string.planner_widget_stale_today)
                }
            }

            if (snapshot.overdue > 0) {
                return context.resources.getQuantityString(
                    R.plurals.planner_widget_overdue,
                    snapshot.overdue,
                    snapshot.overdue,
                )
            }

            return context.getString(R.string.planner_widget_label)
        }

        /**
         * Oeffnet die App. Bewusst ueber den PackageManager statt mit dem
         * Klassennamen der MainActivity: der gehoert zum erzeugten
         * Gradle-Projekt, und diese Bibliothek soll ihn nicht kennen muessen.
         */
        private fun openAppIntent(context: Context, appWidgetId: Int): PendingIntent? {
            val launch = context.packageManager
                .getLaunchIntentForPackage(context.packageName)
                ?: return null

            return PendingIntent.getActivity(
                context,
                appWidgetId,
                launch,
                // Als Vorlage fuer die Zeilen muss das Intent veraenderbar sein -
                // sonst verwirft das System die Fuell-Intents. FLAG_MUTABLE gibt
                // es erst ab Android 12; davor sind PendingIntents ohnehin
                // veraenderbar.
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
                } else {
                    PendingIntent.FLAG_UPDATE_CURRENT
                },
            )
        }

        private fun refreshIntent(context: Context, appWidgetId: Int): PendingIntent {
            val intent = Intent(context.applicationContext, PlannerWidgetProvider::class.java)
                .setAction(ACTION_REFRESH)

            return PendingIntent.getBroadcast(
                context,
                appWidgetId,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }
    }
}

# InstallResultReceiver wird ueber den Namen aus dem Manifest gefunden, die
# Plugin-Klasse von Tauri ueber Reflection - R8 duerfte beide nicht
# umbenennen. Aktuell ist Minify aus; die Regel steht hier fuer den Tag, an
# dem ein Release-Build sie einschaltet.
-keep class de.leifsanden.planner.update.** { *; }

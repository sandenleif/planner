# Die Widget-Klassen werden ueber den Namen aus dem Manifest bzw. von Tauri
# ueber Reflection gefunden - ein Umbenennen durch R8 wuerde sie unauffindbar
# machen. Aktuell ist Minify aus; die Regeln stehen hier fuer den Tag, an dem
# ein Release-Build sie einschaltet.
-keep class de.leifsanden.planner.widget.** { *; }

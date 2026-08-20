plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    // Muss zu PLUGIN_IDENTIFIER in ../src/lib.rs passen: darueber findet Tauri
    // zur Laufzeit die Klasse PlannerWidgetPlugin.
    namespace = "de.leifsanden.planner.widget"

    // compileSdk und minSdk muessen zum erzeugten App-Modul passen. Nachsehen
    // in src-tauri/gen/android/app/build.gradle.kts; weicht es ab, meldet
    // Gradle das beim ersten Build unmissverstaendlich.
    compileSdk = 34

    defaultConfig {
        minSdk = 24
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }

    kotlinOptions {
        jvmTarget = "1.8"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    // Die Tauri-Laufzeit: Plugin, Invoke, die Annotationen. Das Projekt legt
    // `tauri android init` an.
    implementation(project(":tauri-android"))
}

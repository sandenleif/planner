plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    // Muss zu PLUGIN_IDENTIFIER in ../src/lib.rs passen: darueber findet Tauri
    // zur Laufzeit die Klasse PlannerUpdatePlugin.
    namespace = "de.leifsanden.planner.update"

    // Muss zum erzeugten App-Modul passen, siehe
    // src-tauri/gen/android/app/build.gradle.kts. 34 ist noetig, weil unten
    // Build.VERSION_CODES.TIRAMISU (33) benannt wird.
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
    implementation(project(":tauri-android"))
}

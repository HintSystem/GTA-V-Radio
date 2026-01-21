import { audioSettings, uiSettings } from "./source/settings.js"
import { radioMetaPromise } from "./source/constants.js"
import { createRadioStationButtons } from "./source/station-manager.js"
import audio from "./source/audio.js"

import RadioDisplay from "./source/ui/radio-display.js"
import PauseMenu from "./source/ui/pause-menu.js"

import { Speaker, Chevron } from "./source/ui/icons.js"
import { SliderInput } from "./source/ui/components.js"

const accentColors = {
    online: "60, 142, 242",
    michael: "100, 177, 213",
    franklin: "115, 212, 111",
    trevor: "255, 164, 89"
}

const root = document.documentElement
uiSettings.subscribe((key, value, oldValue) => {
    if (typeof value !== "string" || typeof oldValue !== "string") return

    switch (key) {
        case "theme":
            root.classList.remove(oldValue)
            root.classList.add(value)
            break
        case "accentColor":
            if (value in accentColors) {
                root.style.setProperty('--ui-accent-color', accentColors[/** @type {any} */ (value)])
            }
            break
    }
}, true)

const volumeControl = document.getElementById("volumeControl")
const volumeSlider = new SliderInput(audioSettings.property("masterGain"), 0, 1)
const volumeIcon = Speaker.create()

volumeControl.appendChild(volumeSlider.element)
volumeIcon.then((icon) => { volumeControl.insertBefore(icon, volumeSlider.element) })

audioSettings.property("masterGain").subscribe(async (value) => {
    let level = 1
    if (value > 0.7) { level = 3 }
    else if (value > 0.3) { level = 2 }
    else if (value <= 0.01) {
        Speaker.setVariant(volumeIcon, "off")
        return
    }

    await Speaker.setVariant(volumeIcon, null)
    Speaker.setLevel(await volumeIcon, /** @type {any} */ (level))
}, true)

const radioDisplay = new RadioDisplay(document.getElementById("radioDisplay"), audio.context)
audio.musicGain.connect(radioDisplay.analyser)
audio.speechGain.connect(radioDisplay.analyser)

const radioDisplayButton = document.getElementById("radioDisplayButton")
radioDisplayButton.onclick = () => { uiSettings.set("showRadioDisplay", !uiSettings.get("showRadioDisplay")) }

const arrowIcon = Chevron.insertVariant(radioDisplayButton, "down")

uiSettings.property("showRadioDisplay").subscribe((showDisplay) => {
    radioDisplay.setSpectrumEnabled(showDisplay)
    Chevron.setVariant(arrowIcon, (showDisplay) ? "up" : "down")
    radioDisplay.element.classList.toggle("hidden", !showDisplay)
}, true)

const pauseMenu = new PauseMenu("pauseMenu", document.getElementById("mainContent"))
document.body.appendChild(pauseMenu.element)

const settingsButton = document.getElementById("settingsButton")
settingsButton.onclick = () => { pauseMenu.toggleOpen(true) }

window.addEventListener("DOMContentLoaded", async () => {
    const meta = await radioMetaPromise
    createRadioStationButtons(meta)
})
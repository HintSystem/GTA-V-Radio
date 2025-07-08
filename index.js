import { audioSettings, uiSettings } from "./source/settings.js"
import { radioMetaPromise } from "./source/constants.js"
import { createRadioStationButtons } from "./source/station-manager.js"
import PauseMenu from "./source/ui/pause-menu.js"

import { Speaker } from "./source/ui/icons.js"
import { SliderInput } from "./source/ui/components.js"

const accentColors = {
    online: "60, 142, 242",
    michael: "100, 177, 213",
    franklin: "115, 212, 111",
    trevor: "255, 164, 89"
}

const root = document.documentElement
uiSettings.subscribe((key, value, oldValue) => {
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

audioSettings.subscribe(async (key, value) => {
    if (key === "masterGain") {
        const icon = await volumeIcon

        let level = 1
        if (value > 0.7) { level = 3 }
        else if (value > 0.3) { level = 2 }
        else if (value <= 0.01) {
            Speaker.setVariant(icon, "off")
            return
        }

        await Speaker.setVariant(icon, null)
        Speaker.setLevel(icon, /** @type {any} */ (level))
    }
}, true)

window.addEventListener("DOMContentLoaded", () => {
    radioMetaPromise.then((meta) => {
        createRadioStationButtons(meta)
    })
})

const pauseMenu = new PauseMenu("pauseMenu", document.getElementById("mainContent"))
document.body.appendChild(pauseMenu.element)

const settingsButton = document.getElementById("settingsButton")
settingsButton.onclick = () => { pauseMenu.toggleOpen(true) }
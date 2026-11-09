"use client";

import { Sheet } from "@/components/ui/Sheet";
import { Segmented, Toggle } from "@/components/ui/controls";
import { useUi } from "@/stores/ui";

export function SettingsSheet() {
  const open = useUi((s) => s.settingsOpen);
  const setOpen = useUi((s) => s.setSettingsOpen);
  const { sound, haptics, animations, appearance, setSound, setHaptics, setAnimations, setAppearance } = useUi();

  return (
    <Sheet open={open} onClose={() => setOpen(false)} title="Settings" subtitle="Saved on this phone">
      <div className="mt-3.5 overflow-hidden rounded-[18px] bg-surface2">
        {[
          { label: "Sound effects", desc: "Note rustle, chip clack, win chime", on: sound, set: setSound },
          { label: "Haptics", desc: "Tap, place and win vibrations", on: haptics, set: setHaptics },
        ].map((t) => (
          <div key={t.label} className="box-border flex min-h-[60px] items-center gap-3 border-b border-line px-4 py-2">
            <div className="flex-1">
              <div className="text-[15px] font-bold">{t.label}</div>
              <div className="text-xs text-ink3">{t.desc}</div>
            </div>
            <Toggle on={t.on} onChange={t.set} label={t.label} />
          </div>
        ))}
        <div className="px-4 pb-3.5 pt-3">
          <div className="text-[15px] font-bold">Animations</div>
          <div className="mt-2">
            <Segmented
              value={animations}
              onChange={setAnimations}
              options={[
                { value: "full", label: "Full" },
                { value: "reduced", label: "Reduced" },
                { value: "off", label: "Off" },
              ]}
            />
          </div>
        </div>
      </div>
      <div className="mt-3 rounded-[18px] bg-surface2 px-4 pb-3.5 pt-3">
        <div className="text-[15px] font-bold">Appearance</div>
        <div className="mt-2">
          <Segmented
            value={appearance}
            onChange={setAppearance}
            options={[
              { value: "night", label: "Night" },
              { value: "day", label: "Day" },
              { value: "auto", label: "Auto" },
            ]}
          />
        </div>
      </div>
    </Sheet>
  );
}

/**
 * ScannerStatus — detects physical scanning devices available to the browser.
 *
 * Checks (in order of reliability):
 *   1. Web HID API  — USB barcode scanners & Bluetooth HID scanners paired to the OS
 *   2. Web Bluetooth — whether BT is present in the browser (device enumeration
 *      requires a user gesture; we prompt on "Scan for devices")
 *   3. A "last-resort" keyboard-speed heuristic — when neither API is available
 *      the user can do a test scan to confirm the scanner is working.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Usb,
  Bluetooth,
  ScanLine,
  Wifi,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────

type DeviceKind = "hid" | "bluetooth" | "wifi";

interface DetectedDevice {
  kind: DeviceKind;
  name: string;
}

type ScanStatus = "idle" | "scanning" | "ready" | "absent";

interface HidDevice {
  productName?: string;
}

interface HidApi extends EventTarget {
  getDevices(): Promise<HidDevice[]>;
  requestDevice(options: { filters: [] }): Promise<HidDevice[]>;
}

interface BluetoothApi {
  requestDevice(options: {
    acceptAllDevices: true;
    optionalServices: [];
  }): Promise<{ name?: string | null }>;
}

type NavigatorWithDeviceApis = Navigator & {
  hid?: HidApi;
  bluetooth?: BluetoothApi;
};

// ── Helpers ────────────────────────────────────────────────────────────────

const hidSupported = typeof navigator !== "undefined" && "hid" in navigator;
const btSupported = typeof navigator !== "undefined" && "bluetooth" in navigator;

function getHidApi() {
  return typeof navigator === "undefined" ? undefined : (navigator as NavigatorWithDeviceApis).hid;
}

function getBluetoothApi() {
  return typeof navigator === "undefined"
    ? undefined
    : (navigator as NavigatorWithDeviceApis).bluetooth;
}

async function getHidDevices(): Promise<DetectedDevice[]> {
  const hid = getHidApi();
  if (!hid) return [];
  try {
    const devices = await hid.getDevices();
    return devices.map((d) => ({
      kind: "hid" as DeviceKind,
      name: d.productName || "HID device",
    }));
  } catch {
    return [];
  }
}

async function requestHidDevices(): Promise<DetectedDevice[]> {
  const hid = getHidApi();
  if (!hid) return [];
  try {
    // Show the OS device picker — filter: empty means show all HID devices
    const devices = await hid.requestDevice({ filters: [] });
    return devices.map((d) => ({
      kind: "hid" as DeviceKind,
      name: d.productName || "HID device",
    }));
  } catch {
    return [];
  }
}

async function requestBluetoothDevice(): Promise<DetectedDevice | null> {
  const bluetooth = getBluetoothApi();
  if (!bluetooth) return null;
  try {
    const device = await bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [],
    });
    return { kind: "bluetooth", name: device.name || "Bluetooth device" };
  } catch {
    return null;
  }
}

// ── Component ──────────────────────────────────────────────────────────────

export default function ScannerStatus() {
  const { t } = useTranslation();
  const [devices, setDevices] = useState<DetectedDevice[]>([]);
  const [status, setStatus] = useState<ScanStatus>("idle");
  const [scanning, setScanning] = useState(false);

  // On mount, quietly check for already-granted HID devices (no user gesture needed).
  useEffect(() => {
    getHidDevices().then((devs) => {
      if (devs.length > 0) {
        setDevices(devs);
        setStatus("ready");
      } else {
        setStatus("absent");
      }
    });

    // Re-check when a HID device connects or disconnects
    const hid = getHidApi();
    if (hid) {
      const onConnect = () =>
        getHidDevices().then((d) => {
          setDevices(d);
          setStatus(d.length ? "ready" : "absent");
        });
      const onDisconnect = () =>
        getHidDevices().then((d) => {
          setDevices(d);
          setStatus(d.length ? "ready" : "absent");
        });
      hid.addEventListener("connect", onConnect);
      hid.addEventListener("disconnect", onDisconnect);
      return () => {
        hid.removeEventListener("connect", onConnect);
        hid.removeEventListener("disconnect", onDisconnect);
      };
    }
  }, []);

  const handleScanForDevices = async () => {
    setScanning(true);
    const results: DetectedDevice[] = [];

    // 1. Request HID (shows OS device picker — covers USB + BT HID scanners)
    if (hidSupported) {
      const hid = await requestHidDevices();
      results.push(...hid);
    }

    // 2. Also try Bluetooth if no HID devices found
    if (results.length === 0 && btSupported) {
      const bt = await requestBluetoothDevice();
      if (bt) results.push(bt);
    }

    setDevices((prev) => {
      const names = new Set(prev.map((d) => d.name));
      return [...prev, ...results.filter((d) => !names.has(d.name))];
    });
    setStatus(results.length > 0 ? "ready" : "absent");
    setScanning(false);
  };

  const kindIcon = (kind: DeviceKind) => {
    if (kind === "hid") return <Usb className="h-3 w-3" />;
    if (kind === "bluetooth") return <Bluetooth className="h-3 w-3" />;
    return <Wifi className="h-3 w-3" />;
  };

  const isReady = status === "ready";
  const isAbsent = status === "absent";

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-3">
      {/* ── Header row ── */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ScanLine className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">{t("scanner.title")}</span>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold",
            isReady && "bg-success/15 text-success",
            isAbsent && "bg-destructive/15 text-destructive",
            status === "idle" && "bg-secondary text-muted-foreground",
          )}
        >
          {isReady && <CheckCircle2 className="h-3 w-3" />}
          {isAbsent && <XCircle className="h-3 w-3" />}
          {isReady ? t("scanner.ready") : isAbsent ? t("scanner.absent") : t("scanner.checking")}
        </span>
      </div>

      {/* ── Detected devices list ── */}
      {devices.length > 0 && (
        <ul className="space-y-1">
          {devices.map((d, i) => (
            <li key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
              {kindIcon(d.kind)}
              <span className="truncate">{d.name}</span>
              <CheckCircle2 className="ml-auto h-3 w-3 text-success shrink-0" />
            </li>
          ))}
        </ul>
      )}

      {/* ── No-HID-API notice ── */}
      {!hidSupported && !btSupported && (
        <p className="text-xs text-muted-foreground">{t("scanner.api_unavailable")}</p>
      )}

      {/* ── Action buttons ── */}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={scanning}
          onClick={handleScanForDevices}
          className="gap-1.5"
        >
          {scanning ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {t("scanner.scan_btn")}
        </Button>

        {hidSupported && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Usb className="h-3 w-3" /> USB/HID
          </div>
        )}
        {btSupported && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Bluetooth className="h-3 w-3" /> Bluetooth
          </div>
        )}
      </div>
    </div>
  );
}

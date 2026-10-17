import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "@/locales/en.json";

/**
 * English only, as agreed. The translation layer is kept (every screen already
 * reads its copy through `t()`), so adding another language later means adding
 * one locale file and nothing else — no component changes.
 */
i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
  },
  lng: "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;

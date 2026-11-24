import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import * as RadixDropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  defaultAppSettings,
  type AppSettings,
  type AssistantProvider,
  type GeminiApiKeyErrorCode,
  type GeminiApiKeyStatus,
  type LanguagePreference,
  type PixverseAccountSwitchError,
  type PixverseAuthStatus,
  type ThemePreference
} from "../../../shared/types";
import { useI18n } from "../lib/i18n";
import { DropdownMenu, DropdownMenuItem } from "./ui/dropdown-menu";
import { IconButton } from "./ui/icon-button";
import { KitButton } from "./ui/kit-button";
import { SelectTrigger } from "./ui/select";
import { Switch } from "./ui/switch";

interface GeminiCopy {
  title: string;
  description: string;
  statusNotConfigured: string;
  statusConfigured: string;
  statusConfiguredDate: (date: string) => string;
  statusChecking: string;
  statusEncryptionUnavailable: string;
  encryptionHint: string;
  keyPlaceholder: string;
  keyAriaLabel: string;
  save: string;
  saving: string;
  clear: string;
  clearing: string;
  error: Record<GeminiApiKeyErrorCode, string>;
}

// TODO(i18n): 本轮改动范围不含 translations.ts；这些词条必须迁入
// src/renderer/src/lib/translations.ts 的 zh/en 双词典，遵守 AGENTS.md 双语约定。
const geminiStrings: Record<LanguagePreference, GeminiCopy> = {
  zh: {
    title: "Gemini API",
    description: "密钥只保存在本机加密存储中，不写入设置文件、日志或项目目录。",
    statusNotConfigured: "未配置密钥",
    statusConfigured: "已配置",
    statusConfiguredDate: (date) => `已配置 · ${date}`,
    statusChecking: "检查中…",
    statusEncryptionUnavailable: "加密存储不可用",
    encryptionHint: "当前系统钥匙串不可用，无法安全保存密钥。请先启用系统密钥链后重试。",
    keyPlaceholder: "粘贴 Gemini API 密钥",
    keyAriaLabel: "Gemini API 密钥",
    save: "保存密钥",
    saving: "保存中…",
    clear: "清除密钥",
    clearing: "清除中…",
    error: {
      "encryption-unavailable": "系统加密存储不可用，密钥未保存。",
      "invalid-key": "密钥格式不正确，请检查后重试。",
      "storage-failed": "保存密钥失败，请重试。",
      "removal-failed": "清除密钥失败，请重试。"
    }
  },
  en: {
    title: "Gemini API",
    description: "The key is stored only in this machine's encrypted keystore — never in settings files, logs or the project folder.",
    statusNotConfigured: "No key",
    statusConfigured: "Configured",
    statusConfiguredDate: (date) => `Configured · ${date}`,
    statusChecking: "Checking…",
    statusEncryptionUnavailable: "Keystore unavailable",
    encryptionHint: "The system keystore is unavailable, so the key cannot be stored securely. Enable your keychain and try again.",
    keyPlaceholder: "Paste your Gemini API key",
    keyAriaLabel: "Gemini API key",
    save: "Save key",
    saving: "Saving…",
    clear: "Remove key",
    clearing: "Removing…",
    error: {
      "encryption-unavailable": "System keystore is unavailable; the key was not saved.",
      "invalid-key": "The key format looks invalid. Please check it and try again.",
      "storage-failed": "Failed to save the key. Please try again.",
      "removal-failed": "Failed to remove the key. Please try again."
    }
  }
};

// TODO(style): app.css 不在本轮改动范围内，先内联最小样式，后续迁入统一 token。
const geminiKeyInputStyle: CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid var(--color-border-divider)",
  borderRadius: "var(--radius-md)",
  background: "var(--color-background-input)",
  color: "var(--color-text)",
  fontSize: "var(--text-14)",
  lineHeight: "var(--line-14)",
  outline: "none"
};

export type SettingsValues = AppSettings;

interface SettingsDialogProps extends SettingsValues {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPreview: (values: SettingsValues) => void;
  onSave: (values: SettingsValues) => Promise<void>;
  showTranslucentBackground?: boolean;
}

interface SettingsOption<TValue extends string> {
  label: string;
  value: TValue;
}

function SettingsSelect<TValue extends string>({
  ariaLabel,
  onChange,
  options,
  value
}: {
  ariaLabel: string;
  onChange: (value: TValue) => void;
  options: Array<SettingsOption<TValue>>;
  value: TValue;
}): ReactElement {
  const selected = options.find((option) => option.value === value) ?? options[0];

  return (
    <RadixDropdownMenu.Root>
      <RadixDropdownMenu.Trigger asChild>
        <SelectTrigger className="settings-dialog-select" filled label={selected.label} size="sm" aria-label={ariaLabel} />
      </RadixDropdownMenu.Trigger>
      <RadixDropdownMenu.Portal>
        <RadixDropdownMenu.Content className="settings-dialog-select-popover" sideOffset={6} align="end">
          <DropdownMenu className="settings-dialog-select-menu" role="menu">
            {options.map((option) => (
              <RadixDropdownMenu.Item key={option.value} asChild>
                <DropdownMenuItem
                  label={option.label}
                  selected={option.value === value}
                  role="menuitemradio"
                  aria-checked={option.value === value}
                  onClick={() => onChange(option.value)}
                />
              </RadixDropdownMenu.Item>
            ))}
          </DropdownMenu>
        </RadixDropdownMenu.Content>
      </RadixDropdownMenu.Portal>
    </RadixDropdownMenu.Root>
  );
}

export function SettingsDialog({
  assistantProvider,
  assistantProviderOnboardingCompleted,
  language,
  onOpenChange,
  onPreview,
  onSave,
  open,
  pixverseImageDefaultModel,
  showTranslucentBackground = true,
  themePreference,
  translucentBackground
}: SettingsDialogProps): ReactElement {
  const { language: i18nLanguage, t } = useI18n();
  const geminiCopy = geminiStrings[i18nLanguage];
  const [draftThemePreference, setDraftThemePreference] = useState(themePreference);
  const [draftLanguage, setDraftLanguage] = useState(language);
  const [draftTranslucentBackground, setDraftTranslucentBackground] = useState(translucentBackground);
  const [draftAssistantProvider, setDraftAssistantProvider] = useState(assistantProvider);
  const [draftPixverseImageDefaultModel, setDraftPixverseImageDefaultModel] = useState(pixverseImageDefaultModel);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [pixverseAuthStatus, setPixverseAuthStatus] = useState<PixverseAuthStatus | null>(null);
  const [isCheckingPixverse, setIsCheckingPixverse] = useState(false);
  const [isSwitchingPixverse, setIsSwitchingPixverse] = useState(false);
  const [pixverseError, setPixverseError] = useState<string | null>(null);
  const [pixverseImageModels, setPixverseImageModels] = useState<Array<SettingsOption<string>>>([]);
  const [isLoadingPixverseModels, setIsLoadingPixverseModels] = useState(false);
  // Key material is held only as a transient input buffer. It is never added to
  // `saveValues`, never previewed and cleared whenever the dialog closes.
  const [geminiKeyStatus, setGeminiKeyStatus] = useState<GeminiApiKeyStatus | null>(null);
  const [draftGeminiKey, setDraftGeminiKey] = useState("");
  const [isCheckingGeminiKey, setIsCheckingGeminiKey] = useState(false);
  const [isSavingGeminiKey, setIsSavingGeminiKey] = useState(false);
  const [isClearingGeminiKey, setIsClearingGeminiKey] = useState(false);
  const [geminiKeyError, setGeminiKeyError] = useState<string | null>(null);
  const hasInitializedDraftForOpenRef = useRef(false);
  const themeOptions: Array<SettingsOption<ThemePreference>> = [
    { label: t("settings.theme.system"), value: "system" },
    { label: t("settings.theme.light"), value: "light" },
    { label: t("settings.theme.dark"), value: "dark" }
  ];
  const languageOptions: Array<SettingsOption<LanguagePreference>> = [
    { label: t("settings.language.zh"), value: "zh" },
    { label: t("settings.language.en"), value: "en" }
  ];
  const assistantProviderOptions: Array<SettingsOption<AssistantProvider>> = [
    { label: t("settings.assistantProvider.codex"), value: "codex" },
    { label: t("settings.assistantProvider.claudeCli"), value: "claude-cli" }
  ];

  useEffect(() => {
    if (!open) {
      hasInitializedDraftForOpenRef.current = false;
      // Never leave pasted key material in renderer memory after closing.
      setDraftGeminiKey("");
      setGeminiKeyError(null);
      return;
    }
    if (hasInitializedDraftForOpenRef.current) return;
    hasInitializedDraftForOpenRef.current = true;
    setDraftThemePreference(themePreference);
    setDraftLanguage(language);
    setDraftTranslucentBackground(translucentBackground);
    setDraftAssistantProvider(assistantProvider);
    setDraftPixverseImageDefaultModel(pixverseImageDefaultModel);
    setSaveError(null);
  }, [assistantProvider, language, open, pixverseImageDefaultModel, themePreference, translucentBackground]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setIsCheckingPixverse(true);
    setPixverseError(null);
    void window.scatter.getPixverseAuthStatus()
      .then((status) => {
        if (active) setPixverseAuthStatus(status);
      })
      .catch(() => {
        if (active) setPixverseAuthStatus({ availability: "error", authenticated: false });
      })
      .finally(() => {
        if (active) setIsCheckingPixverse(false);
      });
    return () => {
      active = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setIsLoadingPixverseModels(true);
    void window.scatter.getPixverseCapabilities("image")
      .then(({ capabilities }) => {
        if (!active) return;
        setPixverseImageModels((capabilities?.models || []).map((model) => ({ label: model.displayName, value: model.id })));
      })
      .catch(() => {
        if (active) setPixverseImageModels([]);
      })
      .finally(() => {
        if (active) setIsLoadingPixverseModels(false);
      });
    return () => {
      active = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    void refreshGeminiKeyStatus();
  }, [open]);

  const pixverseImageModelOptions = useMemo(() => {
    const options = [...pixverseImageModels];
    if (!options.some((option) => option.value === draftPixverseImageDefaultModel)) {
      options.unshift({
        value: draftPixverseImageDefaultModel,
        label: draftPixverseImageDefaultModel === "gemini-nano-banana-2.1" ? "Nano Banana 2.1" : draftPixverseImageDefaultModel
      });
    }
    return options;
  }, [draftPixverseImageDefaultModel, pixverseImageModels]);

  const saveValues = useMemo(
    () => ({
      themePreference: draftThemePreference,
      language: draftLanguage,
      translucentBackground: draftTranslucentBackground,
      assistantProvider: draftAssistantProvider,
      assistantProviderOnboardingCompleted,
      pixverseImageDefaultModel: draftPixverseImageDefaultModel
    }),
    [assistantProviderOnboardingCompleted, draftAssistantProvider, draftLanguage, draftPixverseImageDefaultModel, draftThemePreference, draftTranslucentBackground]
  );

  useEffect(() => {
    if (!open) return;
    onPreview(saveValues);
  }, [onPreview, open, saveValues]);

  async function save(): Promise<void> {
    setIsSaving(true);
    setSaveError(null);
    try {
      await onSave(saveValues);
      onOpenChange(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : t("settings.saveFailed"));
    } finally {
      setIsSaving(false);
    }
  }

  function pixverseErrorLabel(error: PixverseAccountSwitchError): string {
    switch (error) {
      case "cli-not-found": return t("settings.pixverse.error.cliNotFound");
      case "status-failed": return t("settings.pixverse.error.statusFailed");
      case "logout-failed": return t("settings.pixverse.error.logoutFailed");
      case "login-failed": return t("settings.pixverse.error.loginFailed");
      case "login-incomplete": return t("settings.pixverse.error.loginIncomplete");
    }
  }

  async function refreshPixverseStatus(): Promise<void> {
    setIsCheckingPixverse(true);
    setPixverseError(null);
    try {
      setPixverseAuthStatus(await window.scatter.getPixverseAuthStatus());
    } catch {
      setPixverseAuthStatus({ availability: "error", authenticated: false });
    } finally {
      setIsCheckingPixverse(false);
    }
  }

  async function switchPixverseAccount(): Promise<void> {
    setIsSwitchingPixverse(true);
    setPixverseError(null);
    try {
      const result = await window.scatter.switchPixverseAccount();
      setPixverseAuthStatus(result.status);
      if (!result.ok && result.error) setPixverseError(pixverseErrorLabel(result.error));
    } catch {
      setPixverseError(t("settings.pixverse.error.loginFailed"));
    } finally {
      setIsSwitchingPixverse(false);
    }
  }

  async function refreshGeminiKeyStatus(): Promise<void> {
    setIsCheckingGeminiKey(true);
    try {
      setGeminiKeyStatus(await window.scatter.getGeminiApiKeyStatus());
    } catch {
      setGeminiKeyStatus({ configured: false, encryptionAvailable: false });
    } finally {
      setIsCheckingGeminiKey(false);
    }
  }

  async function saveGeminiKey(): Promise<void> {
    const key = draftGeminiKey.trim();
    if (!key) {
      setGeminiKeyError(geminiCopy.error["invalid-key"]);
      return;
    }

    setIsSavingGeminiKey(true);
    setGeminiKeyError(null);
    try {
      const result = await window.scatter.setGeminiApiKey(key);
      setGeminiKeyStatus(result.status);
      if (result.ok) {
        // Drop the pasted value the moment the encrypted copy is on disk.
        setDraftGeminiKey("");
      } else if (result.error) {
        setGeminiKeyError(geminiCopy.error[result.error]);
      }
    } catch {
      setGeminiKeyError(geminiCopy.error["storage-failed"]);
    } finally {
      setIsSavingGeminiKey(false);
    }
  }

  async function clearGeminiKey(): Promise<void> {
    setIsClearingGeminiKey(true);
    setGeminiKeyError(null);
    try {
      const result = await window.scatter.clearGeminiApiKey();
      setGeminiKeyStatus(result.status);
      if (result.ok) setDraftGeminiKey("");
      else if (result.error) setGeminiKeyError(geminiCopy.error[result.error]);
    } catch {
      setGeminiKeyError(geminiCopy.error["removal-failed"]);
    } finally {
      setIsClearingGeminiKey(false);
    }
  }

  const pixverseStatusLabel = isSwitchingPixverse
    ? t("settings.pixverse.switching")
    : isCheckingPixverse
    ? t("settings.pixverse.checking")
    : pixverseAuthStatus?.availability === "missing"
      ? t("settings.pixverse.cliMissing")
      : pixverseAuthStatus?.availability === "error"
        ? t("settings.pixverse.statusError")
        : pixverseAuthStatus?.authenticated
          ? t("settings.pixverse.loggedIn")
          : t("settings.pixverse.loggedOut");
  const pixverseStatusTone = pixverseAuthStatus?.availability === "missing" || pixverseAuthStatus?.availability === "error"
    ? "is-warning"
    : pixverseAuthStatus?.authenticated
      ? "is-positive"
      : "is-neutral";

  const geminiKeyUpdatedAt =
    geminiKeyStatus?.configured && geminiKeyStatus.updatedAt
      ? new Date(geminiKeyStatus.updatedAt).toLocaleDateString(i18nLanguage === "zh" ? "zh-CN" : "en-US")
      : null;
  const geminiStatusTone = isCheckingGeminiKey || !geminiKeyStatus
    ? "is-neutral"
    : !geminiKeyStatus.encryptionAvailable
      ? "is-warning"
      : geminiKeyStatus.configured
        ? "is-positive"
        : "is-neutral";
  const geminiStatusLabel = isCheckingGeminiKey
    ? geminiCopy.statusChecking
    : !geminiKeyStatus
      ? geminiCopy.statusNotConfigured
      : !geminiKeyStatus.encryptionAvailable
        ? geminiCopy.statusEncryptionUnavailable
        : geminiKeyStatus.configured
          ? geminiKeyUpdatedAt
            ? geminiCopy.statusConfiguredDate(geminiKeyUpdatedAt)
            : geminiCopy.statusConfigured
          : geminiCopy.statusNotConfigured;
  const canSaveGeminiKey =
    draftGeminiKey.trim().length > 0 &&
    geminiKeyStatus?.encryptionAvailable !== false &&
    !isSavingGeminiKey &&
    !isCheckingGeminiKey &&
    !isClearingGeminiKey;

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="settings-dialog-overlay" />
        <RadixDialog.Content className="settings-dialog-content" aria-describedby={undefined}>
          <header className="settings-dialog-header">
            <RadixDialog.Title className="settings-dialog-title">{t("settings.title")}</RadixDialog.Title>
            <RadixDialog.Close asChild>
              <IconButton className="settings-dialog-close" filled={false} icon="x" size="sm" aria-label={t("settings.close")} />
            </RadixDialog.Close>
          </header>

          <div className="settings-dialog-body">
            <div className="settings-dialog-row">
              <span className="settings-dialog-row-label">{t("settings.theme")}</span>
              <SettingsSelect ariaLabel={t("settings.theme")} options={themeOptions} value={draftThemePreference} onChange={setDraftThemePreference} />
            </div>
            <div className="settings-dialog-row">
              <span className="settings-dialog-row-label">{t("settings.language")}</span>
              <SettingsSelect ariaLabel={t("settings.language")} options={languageOptions} value={draftLanguage} onChange={setDraftLanguage} />
            </div>
            <div className="settings-dialog-row">
              <span className="settings-dialog-row-label">{t("settings.assistantProvider")}</span>
              <SettingsSelect
                ariaLabel={t("settings.assistantProvider")}
                options={assistantProviderOptions}
                value={draftAssistantProvider}
                onChange={setDraftAssistantProvider}
              />
            </div>
            {showTranslucentBackground ? (
              <div className="settings-dialog-row">
                <span className="settings-dialog-row-label">{t("settings.translucentBackground")}</span>
                <Switch checked={draftTranslucentBackground} onCheckedChange={setDraftTranslucentBackground} />
              </div>
            ) : null}

            <section className="settings-dialog-pixverse" aria-labelledby="settings-dialog-pixverse-title">
              <div className="settings-dialog-pixverse-heading">
                <h3 id="settings-dialog-pixverse-title">{t("settings.pixverse.title")}</h3>
                <span className={`settings-dialog-pixverse-status ${pixverseStatusTone}`} role="status">
                  {pixverseStatusLabel}
                </span>
              </div>
              <p className="settings-dialog-pixverse-description">{t("settings.pixverse.description")}</p>
              <div className="settings-dialog-row settings-dialog-pixverse-default-model">
                <span className="settings-dialog-row-label">{t("settings.pixverse.defaultImageModel")}</span>
                <SettingsSelect
                  ariaLabel={t("settings.pixverse.defaultImageModel")}
                  options={pixverseImageModelOptions}
                  value={draftPixverseImageDefaultModel}
                  onChange={setDraftPixverseImageDefaultModel}
                />
              </div>
              <p className="settings-dialog-pixverse-description">
                {isLoadingPixverseModels
                  ? t("settings.pixverse.modelsLoading")
                  : pixverseImageModels.length
                    ? t("settings.pixverse.defaultImageModelHint")
                    : t("settings.pixverse.modelsUnavailable")}
              </p>
              <div className="settings-dialog-pixverse-controls">
                <span className="settings-dialog-pixverse-account">
                  {pixverseAuthStatus?.authenticated && pixverseAuthStatus.accountLabel
                    ? t("settings.pixverse.account", { name: pixverseAuthStatus.accountLabel })
                    : ""}
                </span>
                <div className="settings-dialog-pixverse-actions">
                  <KitButton
                    filled={false}
                    size="sm"
                    disabled={isCheckingPixverse || isSwitchingPixverse}
                    onClick={() => void refreshPixverseStatus()}
                  >
                    {t("settings.pixverse.refresh")}
                  </KitButton>
                  {pixverseAuthStatus?.availability === "available" ? (
                    <KitButton
                      filled
                      size="sm"
                      disabled={isCheckingPixverse || isSwitchingPixverse}
                      onClick={() => void switchPixverseAccount()}
                    >
                      {isSwitchingPixverse
                        ? t("settings.pixverse.switching")
                        : pixverseAuthStatus.authenticated
                          ? t("settings.pixverse.switch")
                          : t("settings.pixverse.login")}
                    </KitButton>
                  ) : null}
                </div>
              </div>
              {pixverseError ? <p className="settings-dialog-pixverse-error" role="alert">{pixverseError}</p> : null}
            </section>

            <section className="settings-dialog-pixverse" aria-labelledby="settings-dialog-gemini-title">
              <div className="settings-dialog-pixverse-heading">
                <h3 id="settings-dialog-gemini-title">{geminiCopy.title}</h3>
                <span className={`settings-dialog-pixverse-status ${geminiStatusTone}`} role="status">
                  {geminiStatusLabel}
                </span>
              </div>
              <p className="settings-dialog-pixverse-description">{geminiCopy.description}</p>
              <input
                id="settings-dialog-gemini-key-input"
                style={geminiKeyInputStyle}
                type="password"
                value={draftGeminiKey}
                onChange={(event) => setDraftGeminiKey(event.target.value)}
                placeholder={geminiCopy.keyPlaceholder}
                aria-label={geminiCopy.keyAriaLabel}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                disabled={isSavingGeminiKey || isClearingGeminiKey}
              />
              {geminiKeyStatus && !geminiKeyStatus.encryptionAvailable ? (
                <p className="settings-dialog-pixverse-description">{geminiCopy.encryptionHint}</p>
              ) : null}
              <div className="settings-dialog-pixverse-controls">
                <span className="settings-dialog-pixverse-account" />
                <div className="settings-dialog-pixverse-actions">
                  <KitButton
                    filled={false}
                    size="sm"
                    disabled={!geminiKeyStatus?.configured || isSavingGeminiKey || isClearingGeminiKey}
                    onClick={() => void clearGeminiKey()}
                  >
                    {isClearingGeminiKey ? geminiCopy.clearing : geminiCopy.clear}
                  </KitButton>
                  <KitButton
                    filled
                    size="sm"
                    disabled={!canSaveGeminiKey}
                    onClick={() => void saveGeminiKey()}
                  >
                    {isSavingGeminiKey ? geminiCopy.saving : geminiCopy.save}
                  </KitButton>
                </div>
              </div>
              {geminiKeyError ? <p className="settings-dialog-pixverse-error" role="alert">{geminiKeyError}</p> : null}
            </section>
          </div>

          <footer className="settings-dialog-footer">
            {saveError ? <p className="settings-dialog-error">{saveError}</p> : null}
            <div className="settings-dialog-actions">
              <KitButton
                filled={false}
                size="md"
                disabled={isSaving}
                onClick={() => {
                  setDraftThemePreference(defaultAppSettings.themePreference);
                  setDraftLanguage(defaultAppSettings.language);
                  setDraftTranslucentBackground(defaultAppSettings.translucentBackground);
                  setDraftAssistantProvider(defaultAppSettings.assistantProvider);
                  setDraftPixverseImageDefaultModel(defaultAppSettings.pixverseImageDefaultModel);
                }}
              >
                {t("settings.restoreDefaults")}
              </KitButton>
              <KitButton
                filled
                size="md"
                disabled={isSaving}
                onClick={() => void save()}
              >
                {isSaving ? t("settings.saving") : t("settings.save")}
              </KitButton>
            </div>
          </footer>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

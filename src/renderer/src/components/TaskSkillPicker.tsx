import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import type { SkillCatalogItem } from "../../../shared/types";
import { useI18n } from "../lib/i18n";
import { useScatterStore } from "../store/scatterStore";
import { Icon } from "./ui/icon";
import { taskNodeActions } from "./nodeRuntimeActions";

interface Props {
  nodeId: string;
  selectedSkills: string[];
}

function skillName(value: string): string {
  return value.trim().replace(/^\$+/, "").replace(/\s+/g, "-");
}

export function TaskSkillPicker({ nodeId, selectedSkills }: Props): ReactElement {
  const { t } = useI18n();
  const project = useScatterStore((state) => state.project);
  const projectPath = project?.path;
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState<SkillCatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const loadCatalog = useCallback(async (): Promise<void> => {
    if (!projectPath) return;
    setLoading(true);
    setLoadFailed(false);
    try {
      setCatalog(await window.scatter.listSkills(projectPath));
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  const refreshCatalog = async (): Promise<void> => {
    if (!projectPath) return;
    setLoading(true);
    setLoadFailed(false);
    try {
      setCatalog(await window.scatter.listSkills(projectPath, true));
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void loadCatalog();
  }, [loadCatalog, open]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    window.addEventListener("pointerdown", closeOutside);
    return () => window.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  const normalizedQuery = skillName(query);
  const filteredSkills = useMemo(() => {
    const value = normalizedQuery.toLocaleLowerCase();
    return catalog.filter((skill) => !value || `${skill.name} ${skill.description}`.toLocaleLowerCase().includes(value));
  }, [catalog, normalizedQuery]);
  const exactMatch = catalog.some((skill) => skill.name.toLocaleLowerCase() === normalizedQuery.toLocaleLowerCase());

  const toggleSkill = (name: string): void => {
    const next = selectedSkills.includes(name)
      ? selectedSkills.filter((skill) => skill !== name)
      : [...selectedSkills, name];
    taskNodeActions?.updateNodeData(nodeId, { skills: next });
  };

  const addCustomSkill = (): void => {
    const name = skillName(query);
    if (!name) return;
    if (!selectedSkills.includes(name)) taskNodeActions?.updateNodeData(nodeId, { skills: [...selectedSkills, name] });
    setQuery("");
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    event.stopPropagation();
    if (event.key === "Escape") setOpen(false);
    if (event.key === "Enter" && normalizedQuery && !exactMatch) {
      event.preventDefault();
      addCustomSkill();
    }
  };

  return (
    <div ref={rootRef} className="task-skill-picker nodrag nopan">
      <button
        className={`task-skill-trigger nodrag ${selectedSkills.length ? "has-skills" : ""}`}
        type="button"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        <Icon name="skills" size={14} />
        <span>{t("task.skills")}</span>
        {selectedSkills.length ? <span className="task-skill-count">{selectedSkills.length}</span> : <span className="task-skill-add">+</span>}
      </button>
      {selectedSkills.length ? (
        <div className="task-skill-summary" title={selectedSkills.map((name) => `$${name}`).join(", ")}>
          {selectedSkills.slice(0, 2).map((name) => <span className="task-skill-chip" key={name}>${name}</span>)}
          {selectedSkills.length > 2 ? <span className="task-skill-chip task-skill-chip-more">+{selectedSkills.length - 2}</span> : null}
        </div>
      ) : null}
      {open ? (
        <div className="task-skill-popover nodrag nopan nowheel" role="dialog" aria-label={t("task.skills")} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
          <div className="task-skill-popover-heading">
            <strong>{t("task.skills")}</strong>
            <button className="task-skill-refresh nodrag" type="button" onClick={() => void refreshCatalog()} disabled={loading}>{t("task.refreshSkills")}</button>
          </div>
          <input
            className="task-skill-search nodrag"
            value={query}
            placeholder={t("task.searchSkills")}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={handleSearchKeyDown}
          />
          <div className="task-skill-list nowheel">
            {loading ? <p className="task-skill-empty">{t("task.loadingSkills")}</p> : null}
            {!loading && loadFailed ? <p className="task-skill-empty">{t("task.skillsUnavailable")}</p> : null}
            {!loading && !loadFailed && filteredSkills.map((skill) => {
              const checked = selectedSkills.includes(skill.name);
              return (
                <button key={`${skill.name}:${skill.source}`} className={`task-skill-option nodrag ${checked ? "is-selected" : ""}`} type="button" aria-pressed={checked} onClick={() => toggleSkill(skill.name)}>
                  <span className="task-skill-option-check">{checked ? "✓" : ""}</span>
                  <span className="task-skill-option-copy"><strong>${skill.name}</strong>{skill.description ? <small>{skill.description}</small> : null}</span>
                  <span className="task-skill-source">{t(`task.skillSource.${skill.source}`)}</span>
                </button>
              );
            })}
            {!loading && !loadFailed && !filteredSkills.length ? <p className="task-skill-empty">{t("task.noMatchingSkills")}</p> : null}
          </div>
          {normalizedQuery && !exactMatch ? (
            <button className="task-skill-custom nodrag" type="button" onClick={addCustomSkill}>{t("task.addCustomSkill", { name: `$${normalizedQuery}` })}</button>
          ) : null}
          <p className="task-skill-note">{t("task.skillAvailabilityNote")}</p>
        </div>
      ) : null}
    </div>
  );
}

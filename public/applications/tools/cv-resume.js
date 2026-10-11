/* CV / Resume Creator — fully functional, browser-based, 12 professional templates */

const TEMPLATES = [
  { id: "classic", name: "Classic Professional", tplClass: "tpl-classic" },
  { id: "modern", name: "Modern Minimal", tplClass: "tpl-modern" },
  { id: "executive", name: "Executive", tplClass: "tpl-executive" },
  { id: "creative", name: "Creative", tplClass: "tpl-creative" },
  { id: "twocol", name: "Two-Column", tplClass: "tpl-twocol" },
  { id: "elegant", name: "Elegant Serif", tplClass: "tpl-elegant" },
  { id: "bold", name: "Bold & Dark", tplClass: "tpl-bold" },
  { id: "sidebar", name: "Sidebar Accent", tplClass: "tpl-sidebar" },
  { id: "timeline", name: "Timeline", tplClass: "tpl-timeline" },
  { id: "compact", name: "Compact One-Page", tplClass: "tpl-compact" },
  { id: "infographic", name: "Infographic", tplClass: "tpl-infographic" },
  { id: "harvard", name: "Harvard Classic", tplClass: "tpl-harvard" },
];

let state = {
  fullName: "", jobTitle: "", email: "", phone: "", location: "", website: "", linkedin: "", summary: "",
  experience: [], education: [], skills: [], certifications: [], languages: [],
  activeTemplate: "classic"
};

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style") el.style.cssText = v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (["value", "checked", "disabled", "hidden", "textContent", "id"].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  const add = kid => { if (Array.isArray(kid)) kid.forEach(add); else if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid))); };
  kids.forEach(add);
  return el;
}

function renderTemplatePicker() {
  const container = h("div", { class: "cvrc-template-picker" });
  TEMPLATES.forEach(t => {
    const btn = h("button", {
      class: "cvrc-template-btn" + (state.activeTemplate === t.id ? " active" : ""),
      type: "button",
      onclick: () => { state.activeTemplate = t.id; renderTemplatePicker(); renderPreview(); }
    }, t.name);
    container.append(btn);
  });
  return container;
}

function renderPreview() {
  const preview = document.getElementById("cvrc-preview-content");
  if (!preview) return;
  const tpl = TEMPLATES.find(t => t.id === state.activeTemplate);
  preview.className = "cvrc-preview " + tpl.tplClass;
  preview.innerHTML = buildResumeHTML(state, tpl);
}

function escapeHTML(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildResumeHTML(data, tpl) {
  const { fullName, jobTitle, email, phone, location, website, linkedin, summary, experience, education, skills, certifications, languages } = data;

  const contactParts = [];
  if (email) contactParts.push(escapeHTML(email));
  if (phone) contactParts.push(escapeHTML(phone));
  if (location) contactParts.push(escapeHTML(location));
  if (website) contactParts.push(escapeHTML(website));
  if (linkedin) contactParts.push(escapeHTML(linkedin));
  const contactStr = contactParts.join(" | ");
  const contactItems = contactParts.map(c => `<span>${c}</span>`).join("");

  const sidebarTemplates = ["sidebar", "creative", "twocol"];
  const isSidebar = sidebarTemplates.includes(tpl.id);

  const expHTML = experience.map(e => `
    <div class="tpl-entry">
      <div class="tpl-entry-title">${escapeHTML(e.title || "")}</div>
      <div class="tpl-entry-sub">${escapeHTML(e.company || "")}</div>
      <div class="tpl-entry-date">${escapeHTML(e.startDate || "")}${e.endDate ? " – " + escapeHTML(e.endDate) : ""}</div>
      <div class="tpl-entry-desc">${escapeHTML(e.description || "").replace(/\n/g, "<br>")}</div>
    </div>`).join("");

  const eduHTML = education.map(e => `
    <div class="tpl-entry">
      <div class="tpl-entry-title">${escapeHTML(e.degree || "")}</div>
      <div class="tpl-entry-sub">${escapeHTML(e.institution || "")}</div>
      <div class="tpl-entry-date">${escapeHTML(e.startDate || "")}${e.endDate ? " – " + escapeHTML(e.endDate) : ""}${e.gpa ? " · GPA: " + escapeHTML(e.gpa) : ""}</div>
      <div class="tpl-entry-desc">${escapeHTML(e.description || "").replace(/\n/g, "<br>")}</div>
    </div>`).join("");

  const skillsHTML = skills.map(s => `<span class="tpl-skill-item">${escapeHTML(s)}</span>`).join("");

  const certHTML = certifications.map(c => `
    <div class="tpl-entry">
      <div class="tpl-entry-title">${escapeHTML(c.name || "")}</div>
      <div class="tpl-entry-sub">${escapeHTML(c.issuer || "")} ${c.date ? "· " + escapeHTML(c.date) : ""}</div>
    </div>`).join("");

  const langHTML = languages.length ? languages.map(l => `<span class="tpl-skill-item">${escapeHTML(l.name)}${l.level ? " – " + escapeHTML(l.level) : ""}</span>`).join("") : "";

  if (isSidebar) {
    return `
      <div class="tpl-sidebar-left">
        <div class="tpl-name">${escapeHTML(fullName || "Your Name")}</div>
        <div class="tpl-title-line">${escapeHTML(jobTitle || "Your Job Title")}</div>
        <div class="tpl-section tpl-section-dark">
          <div class="tpl-section-title">Contact</div>
          <div class="tpl-contact">${contactStr ? contactParts.map(c => c + "<br>").join("") : "—"}</div>
        </div>
        ${skills.length ? `<div class="tpl-section tpl-section-dark"><div class="tpl-section-title">Skills</div><div class="tpl-skills-list">${skillsHTML}</div></div>` : ""}
        ${languages.length ? `<div class="tpl-section tpl-section-dark"><div class="tpl-section-title">Languages</div><div class="tpl-skills-list">${langHTML}</div></div>` : ""}
        ${certifications.length ? `<div class="tpl-section tpl-section-dark"><div class="tpl-section-title">Certifications</div>${certHTML}</div>` : ""}
      </div>
      <div class="tpl-sidebar-right">
        ${summary ? `<div class="tpl-section"><div class="tpl-section-title">Summary</div><div class="tpl-entry-desc">${escapeHTML(summary).replace(/\n/g, "<br>")}</div></div>` : ""}
        ${experience.length ? `<div class="tpl-section"><div class="tpl-section-title">Experience</div>${expHTML}</div>` : ""}
        ${education.length ? `<div class="tpl-section"><div class="tpl-section-title">Education</div>${eduHTML}</div>` : ""}
      </div>`;
  }

  return `
    <div class="tpl-header">
      <div class="tpl-name">${escapeHTML(fullName || "Your Name")}</div>
      <div class="tpl-title-line">${escapeHTML(jobTitle || "Your Job Title")}</div>
      <div class="tpl-contact">${isSidebar ? "" : (contactStr || "—")}</div>
      ${tpl.id === "modern" || tpl.id === "timeline" || tpl.id === "infographic" ? `<div class="tpl-contact">${contactItems}</div>` : ""}
    </div>
    ${summary ? `<div class="tpl-section"><div class="tpl-section-title">Professional Summary</div><div class="tpl-entry-desc">${escapeHTML(summary).replace(/\n/g, "<br>")}</div></div>` : ""}
    ${experience.length ? `<div class="tpl-section"><div class="tpl-section-title">Experience</div>${expHTML}</div>` : ""}
    ${education.length ? `<div class="tpl-section"><div class="tpl-section-title">Education</div>${eduHTML}</div>` : ""}
    ${skills.length ? `<div class="tpl-section"><div class="tpl-section-title">Skills</div><div class="tpl-skills-list">${skillsHTML}</div></div>` : ""}
    ${certifications.length && !isSidebar ? `<div class="tpl-section"><div class="tpl-section-title">Certifications</div>${certHTML}</div>` : ""}
    ${languages.length && !isSidebar ? `<div class="tpl-section"><div class="tpl-section-title">Languages</div><div class="tpl-skills-list">${langHTML}</div></div>` : ""}`;
}

function buildForm() {
  const form = h("div", { class: "cvrc-form-panel" });

  // Personal Info
  const personalSection = h("div", { class: "cvrc-section" },
    h("h3", {}, "Personal Information"),
    h("div", { class: "cvrc-field" },
      h("label", { for: "cvrc-fullname" }, "Full Name"),
      h("input", { id: "cvrc-fullname", type: "text", placeholder: "e.g. Priya Sharma", value: state.fullName, oninput: (e) => { state.fullName = e.target.value; renderPreview(); } })
    ),
    h("div", { class: "cvrc-field" },
      h("label", { for: "cvrc-jobtitle" }, "Job Title / Position"),
      h("input", { id: "cvrc-jobtitle", type: "text", placeholder: "e.g. Senior Software Engineer", value: state.jobTitle, oninput: (e) => { state.jobTitle = e.target.value; renderPreview(); } })
    ),
    h("div", { class: "cvrc-row2" },
      h("div", { class: "cvrc-field" },
        h("label", { for: "cvrc-email" }, "Email"),
        h("input", { id: "cvrc-email", type: "email", placeholder: "priya@example.com", value: state.email, oninput: (e) => { state.email = e.target.value; renderPreview(); } })
      ),
      h("div", { class: "cvrc-field" },
        h("label", { for: "cvrc-phone" }, "Phone"),
        h("input", { id: "cvrc-phone", type: "tel", placeholder: "+91 98765 43210", value: state.phone, oninput: (e) => { state.phone = e.target.value; renderPreview(); } })
      )
    ),
    h("div", { class: "cvrc-row2" },
      h("div", { class: "cvrc-field" },
        h("label", { for: "cvrc-location" }, "Location"),
        h("input", { id: "cvrc-location", type: "text", placeholder: "New Delhi, India", value: state.location, oninput: (e) => { state.location = e.target.value; renderPreview(); } })
      ),
      h("div", { class: "cvrc-field" },
        h("label", { for: "cvrc-website" }, "Website"),
        h("input", { id: "cvrc-website", type: "url", placeholder: "https://yoursite.com", value: state.website, oninput: (e) => { state.website = e.target.value; renderPreview(); } })
      )
    ),
    h("div", { class: "cvrc-field" },
      h("label", { for: "cvrc-linkedin" }, "LinkedIn"),
      h("input", { id: "cvrc-linkedin", type: "text", placeholder: "linkedin.com/in/yourname", value: state.linkedin, oninput: (e) => { state.linkedin = e.target.value; renderPreview(); } })
    ),
    h("div", { class: "cvrc-field" },
      h("label", { for: "cvrc-summary" }, "Professional Summary"),
      h("textarea", { id: "cvrc-summary", rows: "4", placeholder: "A brief summary of your professional background and goals…", oninput: (e) => { state.summary = e.target.value; renderPreview(); } }, state.summary)
    )
  );

  // Experience
  const expSection = h("div", { class: "cvrc-section" });
  const expHeader = h("h3", {}, "Work Experience",
    h("button", { type: "button", onclick: () => addExperience() }, "+ Add")
  );
  expSection.append(expHeader);
  const expList = h("div", { id: "cvrc-exp-list" });
  expSection.append(expList);

  // Education
  const eduSection = h("div", { class: "cvrc-section" });
  const eduHeader = h("h3", {}, "Education",
    h("button", { type: "button", onclick: () => addEducation() }, "+ Add")
  );
  eduSection.append(eduHeader);
  const eduList = h("div", { id: "cvrc-edu-list" });
  eduSection.append(eduList);

  // Skills
  const skillsSection = h("div", { class: "cvrc-section" });
  skillsSection.append(h("h3", {}, "Skills"));
  const skillInput = h("input", { type: "text", placeholder: "Type a skill and press Enter or Add", id: "cvrc-skill-input" });
  const skillAddBtn = h("button", { type: "button", onclick: () => addSkill(skillInput) }, "Add");
  skillInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addSkill(skillInput); } });
  skillsSection.append(h("div", { class: "cvrc-skills-input" }, skillInput, skillAddBtn));
  const skillsList = h("div", { class: "cvrc-skills-list", id: "cvrc-skills-list" });
  skillsSection.append(skillsList);

  // Certifications
  const certSection = h("div", { class: "cvrc-section" });
  const certHeader = h("h3", {}, "Certifications",
    h("button", { type: "button", onclick: () => addCertification() }, "+ Add")
  );
  certSection.append(certHeader);
  const certList = h("div", { id: "cvrc-cert-list" });
  certSection.append(certList);

  // Languages
  const langSection = h("div", { class: "cvrc-section" });
  const langHeader = h("h3", {}, "Languages",
    h("button", { type: "button", onclick: () => addLanguage() }, "+ Add")
  );
  langSection.append(langHeader);
  const langList = h("div", { id: "cvrc-lang-list" });
  langSection.append(langList);

  form.append(personalSection, expSection, eduSection, skillsSection, certSection, langSection);
  return form;
}

function renderExperienceList() {
  const list = document.getElementById("cvrc-exp-list");
  if (!list) return;
  list.innerHTML = "";
  state.experience.forEach((exp, idx) => {
    const item = h("div", { class: "cvrc-item" },
      h("button", { class: "cvrc-remove", type: "button", title: "Remove", onclick: () => { state.experience.splice(idx, 1); renderExperienceList(); renderPreview(); } }, "✕"),
      h("div", { class: "cvrc-field" },
        h("label", {}, "Job Title"),
        h("input", { type: "text", value: exp.title || "", placeholder: "e.g. Software Engineer", oninput: (e) => { exp.title = e.target.value; renderPreview(); } })
      ),
      h("div", { class: "cvrc-field" },
        h("label", {}, "Company"),
        h("input", { type: "text", value: exp.company || "", placeholder: "e.g. Infosys", oninput: (e) => { exp.company = e.target.value; renderPreview(); } })
      ),
      h("div", { class: "cvrc-row2" },
        h("div", { class: "cvrc-field" },
          h("label", {}, "Start Date"),
          h("input", { type: "text", value: exp.startDate || "", placeholder: "Jan 2020", oninput: (e) => { exp.startDate = e.target.value; renderPreview(); } })
        ),
        h("div", { class: "cvrc-field" },
          h("label", {}, "End Date"),
          h("input", { type: "text", value: exp.endDate || "", placeholder: "Present", oninput: (e) => { exp.endDate = e.target.value; renderPreview(); } })
        )
      ),
      h("div", { class: "cvrc-field" },
        h("label", {}, "Description"),
        h("textarea", { rows: "3", placeholder: "Key responsibilities and achievements…", oninput: (e) => { exp.description = e.target.value; renderPreview(); } }, exp.description || "")
      )
    );
    list.append(item);
  });
}

function addExperience() {
  state.experience.push({ title: "", company: "", startDate: "", endDate: "", description: "" });
  renderExperienceList();
  renderPreview();
}

function renderEducationList() {
  const list = document.getElementById("cvrc-edu-list");
  if (!list) return;
  list.innerHTML = "";
  state.education.forEach((edu, idx) => {
    const item = h("div", { class: "cvrc-item" },
      h("button", { class: "cvrc-remove", type: "button", title: "Remove", onclick: () => { state.education.splice(idx, 1); renderEducationList(); renderPreview(); } }, "✕"),
      h("div", { class: "cvrc-field" },
        h("label", {}, "Degree / Course"),
        h("input", { type: "text", value: edu.degree || "", placeholder: "e.g. B.Tech Computer Science", oninput: (e) => { edu.degree = e.target.value; renderPreview(); } })
      ),
      h("div", { class: "cvrc-field" },
        h("label", {}, "Institution"),
        h("input", { type: "text", value: edu.institution || "", placeholder: "e.g. IIT Delhi", oninput: (e) => { edu.institution = e.target.value; renderPreview(); } })
      ),
      h("div", { class: "cvrc-row3" },
        h("div", { class: "cvrc-field" },
          h("label", {}, "Start Date"),
          h("input", { type: "text", value: edu.startDate || "", placeholder: "2016", oninput: (e) => { edu.startDate = e.target.value; renderPreview(); } })
        ),
        h("div", { class: "cvrc-field" },
          h("label", {}, "End Date"),
          h("input", { type: "text", value: edu.endDate || "", placeholder: "2020", oninput: (e) => { edu.endDate = e.target.value; renderPreview(); } })
        ),
        h("div", { class: "cvrc-field" },
          h("label", {}, "GPA / Grade"),
          h("input", { type: "text", value: edu.gpa || "", placeholder: "8.5 / 10", oninput: (e) => { edu.gpa = e.target.value; renderPreview(); } })
        )
      ),
      h("div", { class: "cvrc-field" },
        h("label", {}, "Details (optional)"),
        h("textarea", { rows: "2", placeholder: "Relevant coursework, honors, etc.", oninput: (e) => { edu.description = e.target.value; renderPreview(); } }, edu.description || "")
      )
    );
    list.append(item);
  });
}

function addEducation() {
  state.education.push({ degree: "", institution: "", startDate: "", endDate: "", gpa: "", description: "" });
  renderEducationList();
  renderPreview();
}

function addSkill(input) {
  const val = input.value.trim();
  if (!val) return;
  if (!state.skills.includes(val)) {
    state.skills.push(val);
    renderSkillsList();
    renderPreview();
  }
  input.value = "";
}

function renderSkillsList() {
  const list = document.getElementById("cvrc-skills-list");
  if (!list) return;
  list.innerHTML = "";
  state.skills.forEach((s, idx) => {
    const tag = h("span", { class: "cvrc-skill-tag" }, s,
      h("button", { type: "button", title: "Remove", onclick: () => { state.skills.splice(idx, 1); renderSkillsList(); renderPreview(); } }, "✕")
    );
    list.append(tag);
  });
}

function renderCertList() {
  const list = document.getElementById("cvrc-cert-list");
  if (!list) return;
  list.innerHTML = "";
  state.certifications.forEach((cert, idx) => {
    const item = h("div", { class: "cvrc-item" },
      h("button", { class: "cvrc-remove", type: "button", title: "Remove", onclick: () => { state.certifications.splice(idx, 1); renderCertList(); renderPreview(); } }, "✕"),
      h("div", { class: "cvrc-field" },
        h("label", {}, "Certification Name"),
        h("input", { type: "text", value: cert.name || "", placeholder: "e.g. AWS Solutions Architect", oninput: (e) => { cert.name = e.target.value; renderPreview(); } })
      ),
      h("div", { class: "cvrc-row2" },
        h("div", { class: "cvrc-field" },
          h("label", {}, "Issuing Organization"),
          h("input", { type: "text", value: cert.issuer || "", placeholder: "e.g. Amazon Web Services", oninput: (e) => { cert.issuer = e.target.value; renderPreview(); } })
        ),
        h("div", { class: "cvrc-field" },
          h("label", {}, "Date"),
          h("input", { type: "text", value: cert.date || "", placeholder: "Mar 2023", oninput: (e) => { cert.date = e.target.value; renderPreview(); } })
        )
      )
    );
    list.append(item);
  });
}

function addCertification() {
  state.certifications.push({ name: "", issuer: "", date: "" });
  renderCertList();
  renderPreview();
}

function renderLangList() {
  const list = document.getElementById("cvrc-lang-list");
  if (!list) return;
  list.innerHTML = "";
  state.languages.forEach((lang, idx) => {
    const item = h("div", { class: "cvrc-item" },
      h("button", { class: "cvrc-remove", type: "button", title: "Remove", onclick: () => { state.languages.splice(idx, 1); renderLangList(); renderPreview(); } }, "✕"),
      h("div", { class: "cvrc-row2" },
        h("div", { class: "cvrc-field" },
          h("label", {}, "Language"),
          h("input", { type: "text", value: lang.name || "", placeholder: "e.g. English", oninput: (e) => { lang.name = e.target.value; renderPreview(); } })
        ),
        h("div", { class: "cvrc-field" },
          h("label", {}, "Proficiency Level"),
          h("select", { oninput: (e) => { lang.level = e.target.value; renderPreview(); } },
            h("option", { value: "" }, "Select…"),
            h("option", { value: "Native", selected: lang.level === "Native" ? true : undefined }, "Native"),
            h("option", { value: "Fluent", selected: lang.level === "Fluent" ? true : undefined }, "Fluent"),
            h("option", { value: "Advanced", selected: lang.level === "Advanced" ? true : undefined }, "Advanced"),
            h("option", { value: "Intermediate", selected: lang.level === "Intermediate" ? true : undefined }, "Intermediate"),
            h("option", { value: "Basic", selected: lang.level === "Basic" ? true : undefined }, "Basic")
          )
        )
      )
    );
    list.append(item);
  });
}

function addLanguage() {
  state.languages.push({ name: "", level: "" });
  renderLangList();
  renderPreview();
}

function loadSampleData() {
  state.fullName = "Priya Sharma";
  state.jobTitle = "Senior Software Engineer";
  state.email = "priya.sharma@email.com";
  state.phone = "+91 98765 43210";
  state.location = "New Delhi, India";
  state.website = "priyasharma.dev";
  state.linkedin = "linkedin.com/in/priyasharma";
  state.summary = "Results-driven software engineer with 6+ years of experience building scalable web applications and leading cross-functional teams. Passionate about clean code, performance optimization, and mentoring junior developers.";
  state.experience = [
    { title: "Senior Software Engineer", company: "TechCorp India Pvt. Ltd.", startDate: "Jan 2022", endDate: "Present", description: "• Led a team of 5 engineers to build a microservices platform serving 2M+ users\n• Reduced API response times by 40% through caching and query optimization\n• Introduced CI/CD pipelines, reducing deployment time from 2 hours to 15 minutes" },
    { title: "Software Engineer", company: "Digital Solutions Ltd.", startDate: "Jun 2019", endDate: "Dec 2021", description: "• Developed React-based front-end for an enterprise dashboard application\n• Built RESTful APIs using Node.js and Express serving 500K+ daily requests\n• Collaborated with product team to deliver 12 features ahead of schedule" }
  ];
  state.education = [
    { degree: "B.Tech Computer Science", institution: "IIT Delhi", startDate: "2015", endDate: "2019", gpa: "8.7 / 10", description: "Focus on algorithms, data structures, and distributed systems." }
  ];
  state.skills = ["JavaScript", "TypeScript", "React", "Node.js", "Python", "AWS", "Docker", "PostgreSQL", "MongoDB", "Git", "CI/CD", "Agile"];
  state.certifications = [
    { name: "AWS Certified Solutions Architect", issuer: "Amazon Web Services", date: "Mar 2023" },
    { name: "Google Cloud Professional Developer", issuer: "Google Cloud", date: "Nov 2022" }
  ];
  state.languages = [
    { name: "English", level: "Fluent" },
    { name: "Hindi", level: "Native" }
  ];
}

function clearAll() {
  state.fullName = ""; state.jobTitle = ""; state.email = ""; state.phone = ""; state.location = ""; state.website = ""; state.linkedin = ""; state.summary = "";
  state.experience = []; state.education = []; state.skills = []; state.certifications = []; state.languages = [];
  refreshAll();
}

function refreshAll() {
  renderExperienceList();
  renderEducationList();
  renderSkillsList();
  renderCertList();
  renderLangList();
  renderPreview();
}

function exportPDF() {
  const preview = document.getElementById("cvrc-preview-content");
  if (!preview) return;
  const tpl = TEMPLATES.find(t => t.id === state.activeTemplate);
  const printArea = document.getElementById("cvrc-print-area");
  printArea.innerHTML = `<div class="${tpl.tplClass}" style="padding:48px 56px;">${preview.innerHTML}</div>`;
  printArea.classList.add("active");
  // Give the browser a moment to render
  setTimeout(() => { window.print(); printArea.classList.remove("active"); }, 100);
}

function exportHTML() {
  const preview = document.getElementById("cvrc-preview-content");
  if (!preview) return;
  const tpl = TEMPLATES.find(t => t.id === state.activeTemplate);
  const styles = document.querySelector('link[href*="cv-resume.css"]');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${state.fullName || 'Resume'} - CV</title><style>body{margin:0;background:#fff;}${styles ? '' : ''}</style><link rel="stylesheet" href="/applications/cv-resume.css"></head><body><div class="${tpl.tplClass}" style="max-width:800px;margin:0 auto;">${preview.innerHTML}</div></body></html>`;
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = (state.fullName || "resume") + "-cv.html";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function exportJSON() {
  const data = JSON.stringify(state, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = (state.fullName || "resume") + "-cv-data.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function importJSON() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";
  input.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      Object.assign(state, data);
      refreshAll();
      // Also update the form inputs
      const fullnameInput = document.getElementById("cvrc-fullname");
      if (fullnameInput) fullnameInput.value = state.fullName || "";
      const jobInput = document.getElementById("cvrc-jobtitle");
      if (jobInput) jobInput.value = state.jobTitle || "";
      const emailInput = document.getElementById("cvrc-email");
      if (emailInput) emailInput.value = state.email || "";
      const phoneInput = document.getElementById("cvrc-phone");
      if (phoneInput) phoneInput.value = state.phone || "";
      const locationInput = document.getElementById("cvrc-location");
      if (locationInput) locationInput.value = state.location || "";
      const websiteInput = document.getElementById("cvrc-website");
      if (websiteInput) websiteInput.value = state.website || "";
      const linkedinInput = document.getElementById("cvrc-linkedin");
      if (linkedinInput) linkedinInput.value = state.linkedin || "";
      const summaryInput = document.getElementById("cvrc-summary");
      if (summaryInput) summaryInput.value = state.summary || "";
    } catch (err) {
      alert("Could not read that file. Please make sure it is a valid CV data JSON.");
    }
  });
  input.click();
}

/* Mount */
function mount(root) {
  root.innerHTML = "";

  const layout = h("div", { class: "cvrc-layout" });

  // Left: form
  const formPanel = buildForm();

  // Right: preview
  const previewPanel = h("div", { class: "cvrc-preview-area" },
    h("h2", { style: "font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted,#72776c);margin:0 0 14px;font-weight:750;" }, "Choose a Template"),
    renderTemplatePicker(),
    h("h2", { style: "font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted,#72776c);margin:0 0 14px;font-weight:750;" }, "Live Preview"),
    h("div", { class: "cvrc-preview-wrap" },
      h("div", { id: "cvrc-preview-content", class: "cvrc-preview tpl-classic" })
    ),
    h("div", { class: "cvrc-actions" },
      h("button", { class: "tk-btn primary", type: "button", onclick: exportPDF }, "⤓ Download PDF (Print)"),
      h("button", { class: "tk-btn", type: "button", onclick: exportHTML }, "⤓ Export HTML"),
      h("button", { class: "tk-btn", type: "button", onclick: exportJSON }, "⤓ Save Data (JSON)"),
      h("button", { class: "tk-btn", type: "button", onclick: importJSON }, "↥ Load Data (JSON)"),
      h("button", { class: "tk-btn", type: "button", onclick: () => { loadSampleData(); refreshAll(); syncFormFromState(); } }, "★ Load Sample"),
      h("button", { class: "tk-btn", type: "button", onclick: () => { clearAll(); syncFormFromState(); } }, "✕ Clear All")
    )
  );

  // Print area (hidden, used only for printing)
  const printArea = h("div", { id: "cvrc-print-area", class: "cvrc-print-area" });

  layout.append(formPanel, previewPanel);
  root.append(layout, printArea);

  // Add sample data by default so the user sees something
  loadSampleData();
  refreshAll();
  syncFormFromState();
}

function syncFormFromState() {
  const ids = { "cvrc-fullname": "fullName", "cvrc-jobtitle": "jobTitle", "cvrc-email": "email", "cvrc-phone": "phone", "cvrc-location": "location", "cvrc-website": "website", "cvrc-linkedin": "linkedin", "cvrc-summary": "summary" };
  for (const [id, key] of Object.entries(ids)) {
    const el = document.getElementById(id);
    if (el) el.value = state[key] || "";
  }
}

/* Register as the tool module */
const toolSpec = {
  "cv-resume-creator": {
    custom: true,
    mount: mount
  }
};

export default toolSpec;

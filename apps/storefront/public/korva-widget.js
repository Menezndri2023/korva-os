/**
 * KORVA OS embeddable lead-capture widget (docs/BUSINESS_OS_AUDIT.md roadmap item #8 —
 * "CONNECTER MON ENTREPRISE" / widget JavaScript, Business OS brief §9-11).
 *
 * Drop this on ANY existing website — no build step, no framework, no dependency — to let
 * visitors send a lead/contact request straight into KORVA:
 *
 *   <script
 *     src="https://YOUR-KORVA-STOREFRONT-DOMAIN/korva-widget.js"
 *     data-org="your-organization-slug"
 *     data-api-url="https://YOUR-KORVA-API-DOMAIN/api/v1"
 *     async
 *   ></script>
 *
 * Optional attributes: data-label (button text, default "Contactez-nous"),
 * data-color (accent color, default "#1a73e8").
 *
 * Talks only to the existing, already-public `POST /public/:organizationSlug/leads` endpoint —
 * see apps/api/src/public/public.service.ts#createLead. That endpoint already re-derives the
 * organization from the slug and never trusts anything else from the caller, and the API
 * deliberately serves permissive CORS on /public/* for exactly this use case (see
 * apps/api/src/common/middleware/public-cors.middleware.ts) — this script is the other half of
 * that contract.
 */
(function () {
  "use strict";

  var script = document.currentScript;
  if (!script) return;

  var organizationSlug = script.getAttribute("data-org");
  var apiUrl = script.getAttribute("data-api-url");
  if (!organizationSlug || !apiUrl) {
    console.error(
      "[korva-widget] data-org and data-api-url are both required on the <script> tag.",
    );
    return;
  }
  var buttonLabel = script.getAttribute("data-label") || "Contactez-nous";
  var accentColor = script.getAttribute("data-color") || "#1a73e8";
  var endpoint =
    apiUrl.replace(/\/$/, "") +
    "/public/" +
    encodeURIComponent(organizationSlug) +
    "/leads";

  function el(tag, styles, attrs) {
    var node = document.createElement(tag);
    if (styles) node.style.cssText = styles;
    if (attrs) {
      for (var key in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, key)) {
          node.setAttribute(key, attrs[key]);
        }
      }
    }
    return node;
  }

  var panel = el(
    "div",
    "position:fixed;bottom:88px;right:20px;width:320px;max-width:calc(100vw - 40px);" +
      "background:#fff;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,0.2);" +
      "padding:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
      "display:none;z-index:2147483000;box-sizing:border-box;",
  );
  panel.innerHTML =
    '<div style="font-weight:600;font-size:15px;margin-bottom:8px;color:#111;">' +
    "Une question ?</div>" +
    '<div data-k="form">' +
    '<input data-k="name" type="text" placeholder="Votre nom" style="' +
    "width:100%;box-sizing:border-box;margin-bottom:8px;padding:8px;border:1px solid #ccc;" +
    'border-radius:6px;font-size:14px;" />' +
    '<input data-k="email" type="email" placeholder="Votre e-mail *" style="' +
    "width:100%;box-sizing:border-box;margin-bottom:8px;padding:8px;border:1px solid #ccc;" +
    'border-radius:6px;font-size:14px;" />' +
    '<input data-k="phone" type="tel" placeholder="Téléphone (optionnel)" style="' +
    "width:100%;box-sizing:border-box;margin-bottom:8px;padding:8px;border:1px solid #ccc;" +
    'border-radius:6px;font-size:14px;" />' +
    '<textarea data-k="message" placeholder="Votre message *" rows="3" style="' +
    "width:100%;box-sizing:border-box;margin-bottom:8px;padding:8px;border:1px solid #ccc;" +
    'border-radius:6px;font-size:14px;resize:vertical;"></textarea>' +
    '<div data-k="error" style="color:#c0392b;font-size:12px;margin-bottom:8px;display:none;"></div>' +
    '<button data-k="submit" style="' +
    "width:100%;padding:10px;border:none;border-radius:6px;color:#fff;font-size:14px;" +
    'font-weight:600;cursor:pointer;background:' +
    accentColor +
    ';">Envoyer</button>' +
    "</div>" +
    '<div data-k="success" style="display:none;font-size:14px;color:#111;">' +
    "Merci, votre message a bien été envoyé !</div>";

  var toggleButton = el(
    "button",
    "position:fixed;bottom:20px;right:20px;padding:12px 18px;border:none;border-radius:24px;" +
      "color:#fff;font-size:14px;font-weight:600;cursor:pointer;" +
      "box-shadow:0 4px 14px rgba(0,0,0,0.25);z-index:2147483000;" +
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:" +
      accentColor +
      ";",
  );
  toggleButton.textContent = buttonLabel;

  function field(name) {
    return panel.querySelector('[data-k="' + name + '"]');
  }

  toggleButton.addEventListener("click", function () {
    panel.style.display = panel.style.display === "none" ? "block" : "none";
  });

  field("submit").addEventListener("click", function () {
    var email = field("email").value.trim();
    var message = field("message").value.trim();
    var errorNode = field("error");
    errorNode.style.display = "none";

    if (!email || !message) {
      errorNode.textContent = "L'e-mail et le message sont obligatoires.";
      errorNode.style.display = "block";
      return;
    }

    field("submit").disabled = true;
    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: message,
        source: "website_widget",
        contact: {
          email: email,
          firstName: field("name").value.trim() || undefined,
          phone: field("phone").value.trim() || undefined,
        },
      }),
    })
      .then(function (response) {
        if (!response.ok) throw new Error("request failed");
        panel.querySelector('[data-k="form"]').style.display = "none";
        panel.querySelector('[data-k="success"]').style.display = "block";
      })
      .catch(function () {
        errorNode.textContent =
          "Une erreur est survenue, merci de réessayer.";
        errorNode.style.display = "block";
        field("submit").disabled = false;
      });
  });

  function mount() {
    document.body.appendChild(panel);
    document.body.appendChild(toggleButton);
  }

  if (document.body) {
    mount();
  } else {
    document.addEventListener("DOMContentLoaded", mount);
  }
})();

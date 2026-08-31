/**
 * KORVA OS embeddable widget (docs/BUSINESS_OS_AUDIT.md roadmap item #8 —
 * "CONNECTER MON ENTREPRISE" / widget JavaScript, Business OS brief §9-11).
 *
 * Drop this on ANY existing website — no build step, no framework, no dependency — to let
 * visitors interact with a KORVA-powered business straight from that site:
 *
 *   <script
 *     src="https://YOUR-KORVA-STOREFRONT-DOMAIN/korva-widget.js"
 *     data-org="your-organization-slug"
 *     data-api-url="https://YOUR-KORVA-API-DOMAIN/api/v1"
 *     data-mode="leads"
 *     async
 *   ></script>
 *
 * data-mode (optional, default "leads" — unchanged from every embed deployed before this mode
 * attribute existed, so an existing snippet keeps working exactly as-is):
 *   - "leads"    lead-capture form only (the original, unchanged behavior)
 *   - "catalog"  browse offers, add to cart, checkout (guest order)
 *   - "booking"  pick a bookable offer + resource + slot, confirm a booking
 *   - "full"     catalog and booking together, switched via two tabs
 *
 * Other optional attributes: data-label (toggle button text, defaults per mode),
 * data-color (accent color, default "#1a73e8").
 *
 * Talks only to the existing, already-public `/public/:organizationSlug/...` endpoints — see
 * apps/api/src/public/public.service.ts. Every one of those endpoints already re-derives the
 * organization from the slug and re-resolves price/availability server-side, never trusting the
 * caller — the exact same contract apps/storefront's own React pages rely on, just called here
 * from plain DOM/fetch instead. The API deliberately serves permissive CORS on /public/* for
 * exactly this use case (see apps/api/src/common/middleware/public-cors.middleware.ts).
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
  var mode = script.getAttribute("data-mode") || "leads";
  if (mode !== "leads" && mode !== "catalog" && mode !== "booking" && mode !== "full") {
    console.error('[korva-widget] unknown data-mode "' + mode + '", falling back to "leads".');
    mode = "leads";
  }
  var accentColor = script.getAttribute("data-color") || "#1a73e8";
  var defaultLabels = {
    leads: "Contactez-nous",
    catalog: "Boutique",
    booking: "Réserver",
    full: "Boutique & réservation",
  };
  var buttonLabel = script.getAttribute("data-label") || defaultLabels[mode];
  var baseUrl =
    apiUrl.replace(/\/$/, "") + "/public/" + encodeURIComponent(organizationSlug);

  // ---- small DOM/network helpers -------------------------------------------------------

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

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  /** Mirrors apps/storefront's own public-api-client.ts: unwraps the {success,data}/
   *  {success,error} envelope every /public/* response uses, and rejects with the API's own
   *  message on failure so callers can show it directly instead of a generic error. */
  function apiFetch(path, method, body) {
    return fetch(baseUrl + path, {
      method: method || "GET",
      headers: { "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
      .then(function (response) {
        return response.json().then(function (payload) {
          if (!payload.success) {
            var message =
              (payload.error && payload.error.message) || "Une erreur est survenue.";
            throw new Error(message);
          }
          return payload.data;
        });
      });
  }

  function money(amount, currency) {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: currency }).format(
        amount,
      );
    } catch {
      return amount + " " + currency;
    }
  }

  var inputStyle =
    "width:100%;box-sizing:border-box;margin-bottom:8px;padding:8px;border:1px solid #ccc;" +
    "border-radius:6px;font-size:14px;";
  var buttonStyle =
    "width:100%;padding:10px;border:none;border-radius:6px;color:#fff;font-size:14px;" +
    "font-weight:600;cursor:pointer;background:" + accentColor + ";";
  var secondaryButtonStyle =
    "padding:6px 10px;border:1px solid " + accentColor + ";border-radius:6px;color:" +
    accentColor + ";font-size:12px;font-weight:600;cursor:pointer;background:#fff;";
  var errorStyle = "color:#c0392b;font-size:12px;margin:4px 0;";

  function errorNode() {
    return el("div", errorStyle);
  }

  function showError(node, message) {
    node.textContent = message;
    node.style.display = "block";
  }

  // ---- panel/toggle shell ----------------------------------------------------------------

  var panelWide = mode !== "leads";
  var panel = el(
    "div",
    "position:fixed;bottom:88px;right:20px;width:" + (panelWide ? "360px" : "320px") +
      ";max-width:calc(100vw - 40px);max-height:calc(100vh - 140px);overflow-y:auto;" +
      "background:#fff;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,0.2);" +
      "padding:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
      "display:none;z-index:2147483000;box-sizing:border-box;",
  );

  var toggleButton = el(
    "button",
    "position:fixed;bottom:20px;right:20px;padding:12px 18px;border:none;border-radius:24px;" +
      "color:#fff;font-size:14px;font-weight:600;cursor:pointer;" +
      "box-shadow:0 4px 14px rgba(0,0,0,0.25);z-index:2147483000;" +
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:" +
      accentColor + ";",
  );
  toggleButton.textContent = buttonLabel;

  var panelOpened = false;
  toggleButton.addEventListener("click", function () {
    var opening = panel.style.display === "none";
    panel.style.display = opening ? "block" : "none";
    if (opening && !panelOpened) {
      panelOpened = true;
      renderActiveTab();
    }
  });

  // ---- leads mode --------------------------------------------------------------------------

  function renderLeadsPanel(container) {
    clear(container);
    var title = el("div", "font-weight:600;font-size:15px;margin-bottom:8px;color:#111;");
    title.textContent = "Une question ?";
    container.appendChild(title);

    var name = el("input", inputStyle, { type: "text", placeholder: "Votre nom" });
    var email = el("input", inputStyle, { type: "email", placeholder: "Votre e-mail *" });
    var phone = el("input", inputStyle, { type: "tel", placeholder: "Téléphone (optionnel)" });
    var message = el("textarea", inputStyle + "resize:vertical;", {
      placeholder: "Votre message *",
      rows: "3",
    });
    var error = errorNode();
    error.style.display = "none";
    var submit = el("button", buttonStyle);
    submit.textContent = "Envoyer";

    container.appendChild(name);
    container.appendChild(email);
    container.appendChild(phone);
    container.appendChild(message);
    container.appendChild(error);
    container.appendChild(submit);

    submit.addEventListener("click", function () {
      var emailValue = email.value.trim();
      var messageValue = message.value.trim();
      error.style.display = "none";

      if (!emailValue || !messageValue) {
        showError(error, "L'e-mail et le message sont obligatoires.");
        return;
      }

      submit.disabled = true;
      apiFetch("/leads", "POST", {
        message: messageValue,
        source: "website_widget",
        contact: {
          email: emailValue,
          firstName: name.value.trim() || undefined,
          phone: phone.value.trim() || undefined,
        },
      })
        .then(function () {
          clear(container);
          var success = el("div", "font-size:14px;color:#111;");
          success.textContent = "Merci, votre message a bien été envoyé !";
          container.appendChild(success);
        })
        .catch(function (err) {
          showError(error, err.message || "Une erreur est survenue, merci de réessayer.");
          submit.disabled = false;
        });
    });
  }

  // ---- catalog mode -------------------------------------------------------------------------

  var cart = []; // { offerId, name, unitPrice, currency, quantity }

  function cartTotal() {
    return cart.reduce(function (sum, line) {
      return sum + line.unitPrice * line.quantity;
    }, 0);
  }

  function addToCart(offer) {
    var existing = null;
    for (var i = 0; i < cart.length; i++) {
      if (cart[i].offerId === offer.id) {
        existing = cart[i];
        break;
      }
    }
    if (existing) {
      existing.quantity += 1;
    } else {
      cart.push({
        offerId: offer.id,
        name: offer.name,
        unitPrice: offer.pricing.amount,
        currency: offer.pricing.currency,
        quantity: 1,
      });
    }
  }

  function renderCatalogPanel(container) {
    clear(container);
    var title = el("div", "font-weight:600;font-size:15px;margin-bottom:8px;color:#111;");
    title.textContent = "Notre boutique";
    container.appendChild(title);

    var listNode = el("div");
    var errorMsg = errorNode();
    container.appendChild(listNode);
    container.appendChild(errorMsg);

    listNode.textContent = "Chargement…";

    apiFetch("/offers")
      .then(function (offers) {
        clear(listNode);
        var sellable = offers.filter(function (offer) {
          return offer.type !== "booking";
        });
        if (sellable.length === 0) {
          listNode.textContent = "Aucun produit disponible pour le moment.";
          return;
        }
        sellable.forEach(function (offer) {
          var row = el(
            "div",
            "display:flex;align-items:center;justify-content:space-between;gap:8px;" +
              "padding:8px 0;border-bottom:1px solid #eee;",
          );
          var info = el("div", "font-size:13px;color:#111;flex:1;");
          var priceText = money(offer.pricing.amount, offer.pricing.currency);
          info.textContent = offer.name + " — " + priceText;
          var addButton = el("button", secondaryButtonStyle);
          addButton.textContent = "Ajouter";
          addButton.addEventListener("click", function () {
            addToCart(offer);
            renderCartSummary();
          });
          row.appendChild(info);
          row.appendChild(addButton);
          listNode.appendChild(row);
        });
        renderCartSummary();
      })
      .catch(function (err) {
        listNode.textContent = "";
        showError(errorMsg, err.message || "Impossible de charger la boutique.");
      });

    var cartSection = el("div", "margin-top:12px;");
    container.appendChild(cartSection);

    function renderCartSummary() {
      clear(cartSection);
      if (cart.length === 0) return;
      var summary = el("div", "font-size:13px;color:#111;margin-bottom:6px;font-weight:600;");
      summary.textContent =
        "Panier : " + cart.length + " article(s) — " + money(cartTotal(), cart[0].currency);
      cartSection.appendChild(summary);
      var checkoutButton = el("button", buttonStyle);
      checkoutButton.textContent = "Commander";
      checkoutButton.addEventListener("click", function () {
        renderCheckoutForm(container, "catalog");
      });
      cartSection.appendChild(checkoutButton);
    }
  }

  function renderCheckoutForm(container, backTo) {
    clear(container);
    var title = el("div", "font-weight:600;font-size:15px;margin-bottom:8px;color:#111;");
    title.textContent = "Finaliser la commande";
    container.appendChild(title);

    var summary = el("div", "font-size:12px;color:#555;margin-bottom:8px;");
    summary.textContent =
      cart.length + " article(s) — Total : " + money(cartTotal(), cart[0].currency);
    container.appendChild(summary);

    var name = el("input", inputStyle, { type: "text", placeholder: "Prénom" });
    var email = el("input", inputStyle, { type: "email", placeholder: "Votre e-mail *" });
    var phone = el("input", inputStyle, { type: "tel", placeholder: "Téléphone (optionnel)" });
    var error = errorNode();
    error.style.display = "none";
    var submit = el("button", buttonStyle);
    submit.textContent = "Confirmer la commande";
    var back = el("button", secondaryButtonStyle + "margin-top:8px;width:100%;");
    back.textContent = "← Retour";

    container.appendChild(name);
    container.appendChild(email);
    container.appendChild(phone);
    container.appendChild(error);
    container.appendChild(submit);
    container.appendChild(back);

    back.addEventListener("click", function () {
      if (backTo === "catalog") renderCatalogPanel(container);
    });

    submit.addEventListener("click", function () {
      var emailValue = email.value.trim();
      error.style.display = "none";
      if (!emailValue) {
        showError(error, "L'e-mail est obligatoire.");
        return;
      }

      submit.disabled = true;
      apiFetch("/orders", "POST", {
        items: cart.map(function (line) {
          return { offerId: line.offerId, quantity: line.quantity };
        }),
        currency: cart[0].currency,
        contact: {
          email: emailValue,
          firstName: name.value.trim() || undefined,
          phone: phone.value.trim() || undefined,
        },
      })
        .then(function (order) {
          cart = [];
          clear(container);
          var success = el("div", "font-size:14px;color:#111;");
          success.textContent = "Commande " + order.number + " confirmée, merci !";
          container.appendChild(success);
        })
        .catch(function (err) {
          showError(error, err.message || "Impossible de finaliser la commande.");
          submit.disabled = false;
        });
    });
  }

  // ---- booking mode -------------------------------------------------------------------------

  function renderBookingPanel(container) {
    clear(container);
    var title = el("div", "font-weight:600;font-size:15px;margin-bottom:8px;color:#111;");
    title.textContent = "Réserver un créneau";
    container.appendChild(title);

    var listNode = el("div");
    var errorMsg = errorNode();
    container.appendChild(listNode);
    container.appendChild(errorMsg);
    listNode.textContent = "Chargement…";

    apiFetch("/offers")
      .then(function (offers) {
        clear(listNode);
        var bookable = offers.filter(function (offer) {
          return offer.type === "booking";
        });
        if (bookable.length === 0) {
          listNode.textContent = "Aucune prestation réservable pour le moment.";
          return;
        }
        bookable.forEach(function (offer) {
          var row = el(
            "div",
            "display:flex;align-items:center;justify-content:space-between;gap:8px;" +
              "padding:8px 0;border-bottom:1px solid #eee;",
          );
          var info = el("div", "font-size:13px;color:#111;flex:1;");
          info.textContent = offer.name + " — " + money(offer.pricing.amount, offer.pricing.currency);
          var pickButton = el("button", secondaryButtonStyle);
          pickButton.textContent = "Choisir";
          pickButton.addEventListener("click", function () {
            renderBookingForm(container, offer);
          });
          row.appendChild(info);
          row.appendChild(pickButton);
          listNode.appendChild(row);
        });
      })
      .catch(function (err) {
        listNode.textContent = "";
        showError(errorMsg, err.message || "Impossible de charger les prestations.");
      });
  }

  function renderBookingForm(container, offer) {
    clear(container);
    var title = el("div", "font-weight:600;font-size:15px;margin-bottom:8px;color:#111;");
    title.textContent = "Réserver — " + offer.name;
    container.appendChild(title);

    var resourceSelect = el("select", inputStyle);
    var placeholder = el("option", "", { value: "", disabled: "disabled", selected: "selected" });
    placeholder.textContent = "Choisir un emplacement";
    resourceSelect.appendChild(placeholder);
    container.appendChild(resourceSelect);

    var dateInput = el("input", inputStyle, {
      type: "date",
      value: new Date().toISOString().slice(0, 10),
    });
    container.appendChild(dateInput);

    var availabilityNote = el("div", "font-size:12px;color:#555;margin-bottom:8px;");
    container.appendChild(availabilityNote);

    var timeInput = el("input", inputStyle, { type: "time" });
    container.appendChild(timeInput);

    var durationSelect = el("select", inputStyle);
    [
      { label: "30 min", minutes: 30 },
      { label: "1h", minutes: 60 },
      { label: "1h30", minutes: 90 },
      { label: "2h", minutes: 120 },
    ].forEach(function (d) {
      var opt = el("option", "", { value: String(d.minutes) });
      opt.textContent = d.label;
      durationSelect.appendChild(opt);
    });
    container.appendChild(durationSelect);

    var name = el("input", inputStyle, { type: "text", placeholder: "Prénom" });
    var email = el("input", inputStyle, { type: "email", placeholder: "Votre e-mail *" });
    var phone = el("input", inputStyle, { type: "tel", placeholder: "Téléphone (optionnel)" });
    container.appendChild(name);
    container.appendChild(email);
    container.appendChild(phone);

    var error = errorNode();
    error.style.display = "none";
    container.appendChild(error);

    var submit = el("button", buttonStyle);
    submit.textContent = "Confirmer la réservation";
    container.appendChild(submit);

    var back = el("button", secondaryButtonStyle + "margin-top:8px;width:100%;");
    back.textContent = "← Retour";
    back.addEventListener("click", function () {
      renderBookingPanel(container);
    });
    container.appendChild(back);

    function loadAvailability() {
      var resourceId = resourceSelect.value;
      var date = dateInput.value;
      if (!resourceId || !date) return;
      availabilityNote.textContent = "Chargement des disponibilités…";
      apiFetch(
        "/availability?resourceId=" + encodeURIComponent(resourceId) + "&date=" + encodeURIComponent(date),
      )
        .then(function (availability) {
          if (!availability.windows || availability.windows.length === 0) {
            availabilityNote.textContent = "Aucun créneau ce jour-là.";
            return;
          }
          availabilityNote.textContent =
            "Horaires : " +
            availability.windows
              .map(function (w) {
                return w.startTime + "–" + w.endTime;
              })
              .join(", ");
        })
        .catch(function () {
          availabilityNote.textContent = "";
        });
    }

    apiFetch("/resources")
      .then(function (resources) {
        resources.forEach(function (resource) {
          var opt = el("option", "", { value: resource.id });
          opt.textContent = resource.name;
          resourceSelect.appendChild(opt);
        });
      })
      .catch(function () {
        showError(error, "Impossible de charger les emplacements.");
      });

    resourceSelect.addEventListener("change", loadAvailability);
    dateInput.addEventListener("change", loadAvailability);

    submit.addEventListener("click", function () {
      var resourceId = resourceSelect.value;
      var date = dateInput.value;
      var time = timeInput.value;
      var emailValue = email.value.trim();
      error.style.display = "none";

      if (!resourceId || !date || !time) {
        showError(error, "Choisissez un emplacement, une date et une heure.");
        return;
      }
      if (!emailValue) {
        showError(error, "L'e-mail est obligatoire.");
        return;
      }

      var startAt = new Date(date + "T" + time + ":00.000Z");
      var endAt = new Date(startAt.getTime() + Number(durationSelect.value) * 60000);

      submit.disabled = true;
      apiFetch("/bookings", "POST", {
        offerId: offer.id,
        resourceId: resourceId,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        contact: {
          email: emailValue,
          firstName: name.value.trim() || undefined,
          phone: phone.value.trim() || undefined,
        },
      })
        .then(function () {
          clear(container);
          var success = el("div", "font-size:14px;color:#111;");
          success.textContent = "Votre réservation a bien été enregistrée, merci !";
          container.appendChild(success);
        })
        .catch(function (err) {
          showError(error, err.message || "Impossible de confirmer la réservation.");
          submit.disabled = false;
        });
    });
  }

  // ---- "full" mode tabs ----------------------------------------------------------------------

  var activeFullTab = "catalog";

  function renderFullPanel(container) {
    clear(container);
    var tabs = el("div", "display:flex;gap:8px;margin-bottom:8px;");
    var catalogTab = el(
      "button",
      "flex:1;padding:8px;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;",
    );
    var bookingTab = el(
      "button",
      "flex:1;padding:8px;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;",
    );
    catalogTab.textContent = "Boutique";
    bookingTab.textContent = "Réserver";
    tabs.appendChild(catalogTab);
    tabs.appendChild(bookingTab);
    container.appendChild(tabs);

    var body = el("div");
    container.appendChild(body);

    function applyTabStyles() {
      var activeStyle = "background:" + accentColor + ";color:#fff;";
      var inactiveStyle = "background:#f0f0f0;color:#111;";
      catalogTab.style.cssText = catalogTab.style.cssText.split(";")[0] === "" ? "" : catalogTab.style.cssText;
      catalogTab.setAttribute(
        "style",
        "flex:1;padding:8px;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;" +
          (activeFullTab === "catalog" ? activeStyle : inactiveStyle),
      );
      bookingTab.setAttribute(
        "style",
        "flex:1;padding:8px;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;" +
          (activeFullTab === "booking" ? activeStyle : inactiveStyle),
      );
    }

    function renderBody() {
      applyTabStyles();
      if (activeFullTab === "catalog") {
        renderCatalogPanel(body);
      } else {
        renderBookingPanel(body);
      }
    }

    catalogTab.addEventListener("click", function () {
      activeFullTab = "catalog";
      renderBody();
    });
    bookingTab.addEventListener("click", function () {
      activeFullTab = "booking";
      renderBody();
    });

    renderBody();
  }

  // ---- entry point ---------------------------------------------------------------------------

  function renderActiveTab() {
    if (mode === "leads") {
      renderLeadsPanel(panel);
    } else if (mode === "catalog") {
      renderCatalogPanel(panel);
    } else if (mode === "booking") {
      renderBookingPanel(panel);
    } else {
      renderFullPanel(panel);
    }
  }

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

// Account deletion page. Signs the person in (password or emailed link), then calls
// the delete-account Edge Function with their own session. The page holds no secret:
// the function checks the token with Auth and only ever deletes that same account.
(() => {
  "use strict";
  const config = window.KUMQUAT_DELETION || {};
  const $ = (id) => document.getElementById(id);
  const status = $("status");

  function show(message, tone) {
    status.textContent = message;
    status.dataset.tone = tone || "info";
    status.hidden = !message;
  }
  function step(name) {
    for (const id of ["signin", "confirm", "done"]) $(id).hidden = id !== name;
  }

  for (const el of document.querySelectorAll("[data-app-name]")) el.textContent = config.appName || "Kumquat";
  for (const el of document.querySelectorAll("[data-support-link]")) {
    if (config.supportEmail) el.href = `mailto:${config.supportEmail}`;
  }
  if (!config.supabaseUrl || !config.publishableKey || !window.supabase) {
    show("This page is not set up yet. Please contact support.", "error");
    $("signin").hidden = true;
    return;
  }

  // PKCE keeps the emailed link's code useless without this browser's verifier.
  const client = window.supabase.createClient(config.supabaseUrl, config.publishableKey, {
    auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true },
  });

  async function enterConfirm(session) {
    $("confirm").querySelector("[data-email]").textContent = session.user.email || "this account";
    $("understand").checked = false;
    $("delete").disabled = true;
    step("confirm");
    show("");
  }

  $("password-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = $("email").value.trim();
    const password = $("password").value;
    if (!email || !password) return show("Enter your email and password.", "error");
    show("Signing in…");
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    $("password").value = "";
    if (error) {
      return show(
        error.code === "email_not_confirmed"
          ? "Confirm your email address first, using the link we sent when you signed up."
          : "That email and password do not match an account.",
        "error",
      );
    }
    await enterConfirm(data.session);
  });

  $("link-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = $("link-email").value.trim();
    if (!email) return show("Enter your email.", "error");
    // shouldCreateUser: false, so this page never creates accounts. The reply is the
    // same whether or not the address has an account.
    await client.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: window.location.origin + window.location.pathname },
    });
    show("If that address has an account, a sign-in link is on its way. Open it in this browser.", "info");
  });

  $("understand").addEventListener("change", () => {
    $("delete").disabled = !$("understand").checked;
  });

  $("cancel").addEventListener("click", async () => {
    await client.auth.signOut({ scope: "local" });
    step("signin");
    show("Signed out. Nothing was deleted.", "info");
  });

  $("delete").addEventListener("click", async () => {
    $("delete").disabled = true;
    show("Deleting your account…");
    const { error } = await client.functions.invoke("delete-account", { body: {} });
    if (!error) {
      await client.auth.signOut({ scope: "local" });
      step("done");
      show("");
      return;
    }
    const reply = await error.context?.json?.().catch(() => null);
    const reason = reply && reply.reason;
    const messages = {
      active_orders: "You have an order in progress. You can delete your account once it is finished.",
      active_delivery: "You are carrying an order or holding its cash. You can delete your account once it is delivered and the cash is confirmed.",
      staff_account: "Restaurant and administrator accounts are closed by our team. Please contact support.",
    };
    show(
      messages[reason] ||
        (reply && reply.retry
          ? "Your details were removed, but we could not finish. Please try again."
          : "We could not delete your account. Please try again, or contact support."),
      "error",
    );
    $("delete").disabled = !$("understand").checked;
  });

  // Coming back from an emailed link, or with a session still in this browser.
  client.auth.getSession().then(({ data }) => {
    if (data.session) enterConfirm(data.session);
  });
})();

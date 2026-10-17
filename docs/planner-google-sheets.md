# Google Sheets for the current planner

The planner uses Google Identity Services in the browser. Each person explicitly
connects their own Google account. This connection is separate from an app login:
the current planner keeps its workspace in that browser's local storage and does
not provide a hosted, authenticated client portal.

OAuth access tokens remain in memory. They are never written to local storage,
workbook files, app audit entries, URLs, or server logs by this integration. Reload
or token expiry requires reconnecting. Disconnect clears the browser connection
and requests Google token revocation. A user can also remove the app through
[Google Account connections](https://myaccount.google.com/connections).

## Configure Google

1. Create or select a Google Cloud project. Enable the **Google Sheets API** and
   **Google Drive API**.
2. Configure the Google Auth Platform consent screen. Add the users allowed to
   test the app while the OAuth project is in testing mode. Complete any Google
   publication or verification requirements before offering it to other users.
3. Create an OAuth 2.0 **Web application** client. Add the exact app origin to its
   authorized JavaScript origins, including `http://localhost:5173` for local
   development and the actual HTTPS deployment origin for production. A preview
   deployment with a different hostname needs its own allowed origin. The popup
   token flow does not use a server callback or a client secret.
4. Set `GOOGLE_CLIENT_ID` on the server and restart it, or paste the public client
   ID under **Google Sheets → Google Sheets connection**. The config endpoint
   `/api/integrations/google-config` returns only this public client ID.
5. To select pre-existing files, enable the **Google Picker API** in the same
   project. Create a public API key restricted to the app's HTTP referrers and
   Picker API. Enter it in the optional **Public Picker API key** field. This is a
   public browser key, not a Google client secret. Its project must match the
   OAuth client.

The requested OAuth scope is
`https://www.googleapis.com/auth/drive.file`. The Sheets API accepts this scope.
It grants access to files created by this app or explicitly chosen with Google
Picker, rather than requesting access to every spreadsheet in the account.
Pasting a spreadsheet ID does not itself grant access. Use **Choose existing
spreadsheet** or **Create new spreadsheet** if a pasted ID returns a permission
error. Switching Google accounts requires selecting a destination accessible to
that account.

## Transfer a workspace

1. Open **Google Sheets**, choose **Connect Google**, and select your account.
2. Create a new spreadsheet or choose an existing spreadsheet with Picker.
3. Choose **Preview push → Google** to compare local and remote rows and changed
   cells. **Confirm push** writes only the listed app-managed tabs. Creating a
   spreadsheet makes an empty file; it does not automatically transfer tax data.
4. Edit the exported typed source tables in Google, using the same rules as the
   Excel workbook. Keep JSON Pointer paths, types, chunk ordering, and required
   headers intact. The Summary, 1040 comparison, and Module totals tabs are calculated review
   outputs; editing them does not change inputs.
5. Choose **Preview pull ← Google** to validate the entire workbook without
   changing local data. **Apply pull** explicitly replaces this browser's tax
   workspace and recalculates from the imported inputs. Export an Excel backup
   first if you need the existing local version.

The transfer covers the complete saved workspace, including all clients and
prior-year client records, source modules, planning columns, notes, and audit
entries. It also includes the legacy training workbooks and nonsecret app
preferences that are part of the workspace. API credentials and Google connection
preferences are excluded by the shared Excel workbook serializer. A pull preserves
the recipient browser's own credentials and Google destination settings.

The managed tabs are `TM_Workbook info`, `TM_Workspace`, `TM_Clients`,
`TM_Sources`, `TM_Plans`, `TM_Notes`, `TM_Audit`, `TM_Summary`,
`TM_1040 comparison`, `TM_Module totals`, and `TM_Sync`. Other tabs, even unrelated tabs beginning
with `TM_`, remain untouched. Writes use typed Google `stringValue`, `numberValue`,
and `boolValue` cells, so text beginning with `=` is not executed as a formula.
Pulls read the actual entered cell types rather than evaluated results. A real
Google formula in any editable table blocks import and must first be replaced
with a literal value. A text cell whose contents happen to begin with `=` is
preserved. Formula edits also participate in conflict detection, including when
their evaluated result has not changed.

## Conflicts and limits

Transfers are manual, not an automatic background sync. The app compares the
managed tab contents to the last verified transfer and checks them again just
before writing or applying a pull. Local state is checked again after the remote
verification returns, preserving edits made while that network request was in
flight. A remote change blocks another push until a
pull is reviewed. Edits after either preview require a fresh preview. There is no
silent merge.

Google Sheets does not provide an atomic conditional cell write for this flow.
Avoid editing a workbook in two places during a transfer. The app verifies the
written contents afterward and reports a mismatch if another edit intervened.
If the network fails after a write was sent, preview a pull to see the actual
remote contents before retrying. Transfers are limited to 300,000 cells; use Excel
for larger workspaces.

Permission errors, revoked or expired authorization, blocked popups, missing
configuration, invalid workbooks, and offline failures appear in the connection
view. They do not silently replace local tax data. Google Cloud setup and live
OAuth authorization require the owner's Google project and account; mocked tests
verify the transport and conflict handling without sending any client data to
Google.

Run the transport checks with:

```sh
node --test planner/tests/tm-sheets.test.cjs
```

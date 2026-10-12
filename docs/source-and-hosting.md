# Source and hosting

The application source is maintained in the public GitHub repository https://github.com/himeshFHF/Travel-Tool. The live app is hosted privately by ChatGPT Sites at https://wayfarer-travel-tool.workspace-994687.chatgpt.site/.

## Imported release

The first source sync copied the application from Sites commit 2637a1887927c89bde7276368cbb40040eb0729e, deployed in version appgprj_6acc5097e4f88191903076cae23058c0~appgver_74f76942adc081918ab4ab5521e7dd96. It added a CI workflow, its Playwright configuration, and this release guide. These files are now retained in both repositories so subsequent releases can have identical source trees. Earlier GitHub source remains in the parent commit history.

## Release workflow

1. The owner approved this repository being public. Keep uploaded documents, booking emails, local database state, credentials, and runtime directories out of Git.
2. Read the current GitHub head and deployed Sites version before making changes. Preserve any work that has advanced on either side; never force-push to resolve divergence.
3. Implement and validate the change. Use disposable preview data for browser tests.
4. Save and package through the Sites plugin workflow, then sync that source into GitHub. Use a normal push when authenticated Git is available, or the connected GitHub tree/commit/ref tools with an expected-head check. Record the Sites source commit in the GitHub commit message.
5. Confirm GitHub Actions passes, then deploy the matching archive through Sites with the existing project ID and audience. GitHub pushes do not automatically deploy the app.
6. Verify the GitHub source files match the deployed Sites source. Report the GitHub commit and Site URL separately.

Sites stores trip records in D1 and original uploads in R2. These records and files are not part of this source repository. GitHub Actions uses a fresh local preview for tests and does not connect to production storage.

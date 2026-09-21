# Standalone Repository Git Cutover Record

> [!NOTE]
> **CUTOVER COMPLETED ON 2026-09-21**
> The standalone repository git cutover has been successfully executed.
> - **Remote Repository:** [https://github.com/Dhruv6576/Ewrone.git](https://github.com/Dhruv6576/Ewrone.git)
> - **Visibility:** Private
> - **First Successful Pipeline Run:** [https://github.com/Dhruv6576/Ewrone/actions/runs/35632969125](https://github.com/Dhruv6576/Ewrone/actions/runs/35632969125)
> - **Parent Repository Safeguarded:** `C:\Dhruv\Projectss` (`Shree-Hari-Electronics.git`) remains unchanged at commit `bb34e9868e6c9d6372c657f72a8a9909f0c13710`.
> 
> The steps below are retained for audit trail and historical reference; all manual execution steps are completed.

---

## 1. Context & Architecture Anomaly

The current directory `C:\Dhruv\Projectss\Box Codex` is currently situated as a child folder inside an active parent worktree:
- **Parent Work-Tree Root**: `C:\Dhruv\Projectss`
- **Parent Remote Origin**: `https://github.com/Dhruv6576/Shree-Hari-Electronics.git` (an unrelated project)

To prepare Box Codex for team collaboration across 5–6 engineers, it must be initialized as its own isolated, standalone Git repository without modifying, corrupting, or committing into the parent `C:\Dhruv\Projectss\.git`.

---

## 2. Pre-Cutover Prerequisite: Key Rotation

Before initializing the repository or staging files:
1. Log in to your **Razorpay Dashboard** (Test Mode).
2. **Regenerate Key Secret** for Key ID `rzp_test_...GIhl`.
3. Update `supabase/functions/.env` with the newly generated `RAZORPAY_KEY_SECRET`.
4. Ensure `supabase/functions/.env` has proper file system permissions and is never tracked.

---

## 3. Step-by-Step Cutover Execution Reference (Completed)

### Step A: Protect the Parent Repository [COMPLETED]
Ensure the parent `.git` remains completely untouched:
```powershell
# Optional manual safety backup of parent .git
Copy-Item -Path "C:\Dhruv\Projectss\.git" -Destination "C:\Dhruv\Projectss-git-parent-backup" -Recurse
```

### Step B: Initialize Dedicated Git Repository Inside Box Codex [COMPLETED]
Change directory to the Box Codex project root and initialize Git:
```powershell
cd "C:\Dhruv\Projectss\Box Codex"
git init -b main
```

### Step C: Confirm Sensitive File Exclusions [COMPLETED]
Verify that `.gitignore` prevents tracking secrets, especially `supabase/functions/.env`:
```powershell
# Run check-ignore probes. All four must return the ignored path:
git check-ignore supabase/functions/.env
git check-ignore apps/player/.env.local
git check-ignore apps/owner/.env.local
git check-ignore apps/admin/.env.local
```
*If any of these commands returns empty, STOP immediately. Do not proceed to `git add` until `.gitignore` is fixed.*

### Step D: Stage Files for the Initial Commit [COMPLETED]
Stage non-ignored files:
```powershell
git add .
```

### Step E: Pre-Commit Verification Commands [COMPLETED]
Run these exact verification commands before committing:

1. **Verify File Count**:
   ```powershell
   git ls-files | Measure-Object -Line
   ```
   *Verify that no build artifacts (`.next/`), `node_modules/`, or temporary files are staged.*

2. **Verify Sensitive File Non-Inclusion**:
   ```powershell
   # MUST return error / non-zero (proving the file is NOT staged)
   git ls-files --error-unmatch supabase/functions/.env
   git ls-files --error-unmatch apps/player/.env.local
   git ls-files --error-unmatch apps/owner/.env.local
   git ls-files --error-unmatch apps/admin/.env.local
   ```

3. **Automated Secret Scan**:
   ```powershell
   # Scan staged files for accidental secret patterns
   git grep -i "rzp_test_" HEAD 2>$null
   git grep -i "eyJh" HEAD 2>$null
   git grep -i "BEGIN PRIVATE KEY" HEAD 2>$null
   ```

### Step F: Create the Initial Commit [COMPLETED]
Once verified clean:
```powershell
git commit -m "feat(core): initial commit for Box Codex monorepo"
```

### Step G: Connect Remote Origin & Push [COMPLETED]
Linked to private repository `https://github.com/Dhruv6576/Ewrone.git` and pushed `main`:
```powershell
git remote add origin https://github.com/Dhruv6576/Ewrone.git
git push -u origin main
```

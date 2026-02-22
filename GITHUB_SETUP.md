# Put this project on GitHub

Follow these steps to put **gads-report** online on GitHub.

---

## 1. Create a new repository on GitHub

1. Go to [github.com](https://github.com) and sign in.
2. Click the **+** (top right) → **New repository**.
3. Set:
   - **Repository name:** `gads-report` (or any name you like).
   - **Visibility:** **Private** (recommended if you have login/credentials) or **Public**.
   - **Do not** check “Add a README” or “Add .gitignore” (you already have them).
4. Click **Create repository**.

---

## 2. Push your code from your computer

In a terminal, go to your project folder and run:

```bash
cd "/Users/shubham/Desktop/Final Reporting/Attempt 2/gads-report"

# Initialize git (only needed once)
git init

# Add all files (credentials.json and screenshots/ are ignored via .gitignore)
git add .

# First commit
git commit -m "Initial commit: G-Ads reporting app"

# Rename branch to main (if GitHub uses main)
git branch -M main

# Add GitHub as remote (replace YOUR_USERNAME and YOUR_REPO with your GitHub repo)
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git

# Push to GitHub
git push -u origin main
```

**Replace** `YOUR_USERNAME` with your GitHub username and `YOUR_REPO` with the repository name (e.g. `gads-report`).

Example:
```bash
git remote add origin https://github.com/johndoe/gads-report.git
git push -u origin main
```

If GitHub asks for login, use a **Personal Access Token** (Settings → Developer settings → Personal access tokens) as the password when prompted.

---

## 3. After the first push

- Your code will be at: `https://github.com/YOUR_USERNAME/gads-report`
- To push later changes:
  ```bash
  git add .
  git commit -m "Describe your change"
  git push
  ```

**Note:** `credentials.json` and the `screenshots/` folder are in `.gitignore` and will **not** be uploaded. Keep credentials only on your machine or server and never commit them.

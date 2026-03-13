# Adding iOS App to Existing Repository as a Branch

## Strategy: iOS App in a Separate Branch

This approach keeps your web app (main branch) and iOS app (ios-app branch) in the same repository but on different branches. This is useful when:
- They share the same Firebase backend
- You want to keep them logically connected
- You don't need both codebases checked out simultaneously

## Step-by-Step Instructions

### 1. Switch to Your Web App Repository

```bash
# Navigate to your existing repository
cd /path/to/your/firebase-web-app

# Make sure you're on the main branch and it's up to date
git checkout main
git pull origin main
```

### 2. Create the iOS Branch

```bash
# Create and switch to a new branch for iOS
git checkout -b ios-app

# Verify you're on the new branch
git branch
```

### 3. Reorganize for Multi-Platform Structure (Optional but Recommended)

You can either keep everything at root level OR organize by platform:

**Option A: Platform Folders (Recommended)**
```bash
# Move web files into a web/ folder
mkdir web
git mv index.html web/  # move your web files
git mv *.js web/
git mv *.css web/
# etc...

# Create iOS folder
mkdir -p ios/KarasawaLabs
```

**Option B: Keep Separate (Simpler)**
Just create the iOS folder alongside your web files:
```bash
mkdir -p ios/KarasawaLabs
```

### 4. Add iOS Files to the Repository

Copy the iOS app files I created into your repository:

```bash
# From the root of your repository
mkdir -p ios/KarasawaLabs/Services
mkdir -p ios/KarasawaLabs/Views

# Copy the files (you'll need to copy from where I created them)
# ios/KarasawaLabs/KarasawaLabsApp.swift
# ios/KarasawaLabs/ContentView.swift
# ios/KarasawaLabs/Info.plist
# ios/KarasawaLabs/Services/FirebaseService.swift
# ios/KarasawaLabs/Views/AuthenticationView.swift
# ios/Package.swift
# ios/SETUP_GUIDE.md
```

### 5. Update .gitignore

Add iOS-specific ignore rules to your existing .gitignore:

```bash
# Append iOS rules to your existing .gitignore
cat >> .gitignore << 'EOF'

# iOS / Xcode
xcuserdata/
*.xcscmblueprint
*.xccheckout
build/
DerivedData/
*.moved-aside
*.pbxuser
!default.pbxuser
*.mode1v3
!default.mode1v3
*.mode2v3
!default.mode2v3
*.perspectivev3
!default.perspectivev3
*.hmap
*.ipa
*.dSYM.zip
*.dSYM
.build/
Pods/
ios/GoogleService-Info.plist
.DS_Store
EOF
```

### 6. Commit the iOS App

```bash
# Stage all iOS files
git add ios/
git add .gitignore

# Commit
git commit -m "Add iOS app for Karasawa Labs

- SwiftUI app with Firebase integration
- Authentication flow (sign in/sign up)
- Firebase service layer for Firestore operations
- Setup guide and documentation"

# Push the new branch to remote
git push -u origin ios-app
```

### 7. Working with Both Branches

**To work on the web app:**
```bash
git checkout main
# Your iOS files disappear, web files appear
```

**To work on the iOS app:**
```bash
git checkout ios-app
# Your web files may disappear (if restructured), iOS files appear
```

**To merge changes between branches (if needed):**
```bash
# If you updated shared config files like .firebaserc
git checkout ios-app
git merge main
```

## Alternative: Monorepo Approach (Both on Main Branch)

If you prefer having both web and iOS code on the same branch:

```bash
# Stay on main branch
git checkout main

# Create platform structure
mkdir -p web ios/KarasawaLabs

# Move web files to web folder
git mv index.html web/
# ... move other web files

# Add iOS files to ios folder
# Copy iOS files into ios/KarasawaLabs/

# Commit everything
git add .
git commit -m "Restructure repo for web and iOS apps"
git push origin main
```

Your repository would look like:
```
your-repo/
├── .firebaserc
├── .gitignore
├── README.md
├── web/
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── ios/
    ├── KarasawaLabs/
    │   ├── KarasawaLabsApp.swift
    │   ├── ContentView.swift
    │   └── ...
    ├── Package.swift
    └── SETUP_GUIDE.md
```

## Recommendations

**Use separate branches if:**
- You want to keep web and iOS development isolated
- Different team members work on each platform
- You want simpler deployments (web from main, iOS from ios-app)

**Use monorepo (same branch) if:**
- You frequently need both codebases
- You want to track changes across platforms together
- You share code/types between web and iOS (via TypeScript/Swift interop tools)

## Next Steps

1. Choose your approach (separate branches or monorepo)
2. Follow the steps above to add your iOS code
3. Update your repository README to document both apps
4. Set up CI/CD for both platforms if needed

## GitHub/GitLab Tips

On GitHub/GitLab, you can:
- Set different default branches for web vs iOS
- Create separate CI/CD workflows per branch
- Use branch protection rules for each platform
- View branch comparisons to see platform-specific changes

#!/bin/bash
echo "=== GIT STATUS CHECK ==="

echo "Current directory:"
pwd

echo -e "\nGit status:"
git status

echo -e "\nUntracked files:"
git ls-files --others --exclude-standard

echo -e "\nModified files:"
git diff --name-only

echo -e "\nStaged files:"
git diff --cached --name-only

echo -e "\nLast commit:"
git log --oneline -1

echo -e "\nRemote repositories:"
git remote -v

echo -e "\nCurrent branch:"
git branch

echo -e "\nFiles ignored by .gitignore:"
git status --ignored

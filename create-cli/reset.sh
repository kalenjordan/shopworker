#!/bin/bash

# Reset Shopworker Instance
# This script removes and recreates a shopworker instance directory

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
GRAY='\033[0;90m'
NC='\033[0m' # No Color
BOLD='\033[1m'

echo -e "${BLUE}${BOLD}\n🔄  Reset Shopworker Instance\n${NC}"

# Get current directory info
CURRENT_DIR=$(pwd)
CURRENT_DIR_NAME=$(basename "$CURRENT_DIR")
PARENT_DIR=$(dirname "$CURRENT_DIR")

# Safety check: ensure we're in a shopworker-* directory
if [[ ! "$CURRENT_DIR_NAME" =~ ^shopworker- ]]; then
    echo -e "${RED}\n❌  ERROR: This script must be run from a 'shopworker-*' directory.${NC}"
    echo -e "${GRAY}Current directory: $CURRENT_DIR_NAME${NC}"
    echo -e "${GRAY}Expected pattern: shopworker-<something>${NC}\n"
    exit 1
fi

# Check if we're in a shopworker directory by looking for README with shopworker content
IS_SHOPWORKER_DIR=false
if [ -f "README.md" ]; then
    if grep -qi "shopworker" README.md 2>/dev/null; then
        IS_SHOPWORKER_DIR=true
    fi
fi

if [ "$IS_SHOPWORKER_DIR" = false ]; then
    echo -e "${YELLOW}\n⚠️  Not in a Shopworker directory.${NC}"
    echo -e "${GRAY}No Shopworker instance found to reset.${NC}\n"
    exit 0
fi

# Set up directories
MAIN_DIR="$CURRENT_DIR"
LOCAL_DIR="$PARENT_DIR/${CURRENT_DIR_NAME}-local"
REPO_NAME="$CURRENT_DIR_NAME"

# Show what will be reset
echo -e "${YELLOW}\n⚠️  The following directories will be reset:${NC}"
echo -e "${NC}  - Main directory: $MAIN_DIR${NC}"
echo -e "${NC}  - Local directory: $LOCAL_DIR${NC}"

# Prompt for confirmation
echo -e "\n${YELLOW}Are you sure you want to reset this Shopworker instance? (y/N)${NC}"
read -r CONFIRM
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo -e "${RED}Reset cancelled.${NC}"
    exit 0
fi

# Move to parent directory before deletion
echo -e "${GRAY}Moving to parent directory...${NC}"
cd "$PARENT_DIR"

# Delete main directory
echo -e "\n${GRAY}Deleting ${REPO_NAME} directory...${NC}"
if [ -d "$MAIN_DIR" ]; then
    rm -rf "$MAIN_DIR"
    echo -e "${GREEN}✓ ${REPO_NAME} directory deleted${NC}"
else
    echo -e "${YELLOW}⚠ ${REPO_NAME} directory not found${NC}"
fi

# Delete local directory
echo -e "${GRAY}Deleting ${REPO_NAME}-local directory...${NC}"
if [ -d "$LOCAL_DIR" ]; then
    rm -rf "$LOCAL_DIR"
    echo -e "${GREEN}✓ ${REPO_NAME}-local directory deleted${NC}"
else
    echo -e "${YELLOW}⚠ ${REPO_NAME}-local directory not found${NC}"
fi

# Recreate the main directory
echo -e "${GRAY}Recreating ${REPO_NAME} directory...${NC}"
mkdir -p "$MAIN_DIR"
echo -e "${GREEN}✓ ${REPO_NAME} directory recreated${NC}"

echo -e "${GREEN}${BOLD}\n✅ Shopworker instance reset successfully!\n${NC}"
echo -e "${GRAY}The ${REPO_NAME} directory is now empty and ready for re-initialization.${NC}"

# Output command for shell to evaluate
echo -e "\n${YELLOW}⚠️  Your shell is still in the old directory. Run this command:${NC}"
echo -e "${BLUE}cd \"$MAIN_DIR\"${NC}\n"

# Also output for shell evaluation (no color codes)
echo "SHOPWORKER_RESET_CD=$MAIN_DIR"
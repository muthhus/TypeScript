/* @internal */
namespace ts.Rename {
    export function getRenameInfo(program: Program, sourceFile: SourceFile, position: number): RenameInfo {
        const node = getTouchingPropertyName(sourceFile, position);
        const renameInfo = node && nodeIsEligibleForRename(node)
            ? getRenameInfoForNode(node, program.getTypeChecker(), sourceFile, declaration => program.isSourceFileDefaultLibrary(declaration.getSourceFile()))
            : undefined;
        return renameInfo || getRenameInfoError(Diagnostics.You_cannot_rename_this_element);
    }

    function getRenameInfoForNode(node: Node, typeChecker: TypeChecker, sourceFile: SourceFile, isDefinedInLibraryFile: (declaration: Node) => boolean): RenameInfo | undefined {
        const symbol = typeChecker.getSymbolAtLocation(node);
        if (!symbol) return;
        // Only allow a symbol to be renamed if it actually has at least one declaration.
        const { declarations } = symbol;
        if (!declarations || declarations.length === 0) return;

        // Disallow rename for elements that are defined in the standard TypeScript library.
        if (declarations.some(isDefinedInLibraryFile)) {
            return getRenameInfoError(Diagnostics.You_cannot_rename_elements_that_are_defined_in_the_standard_TypeScript_library);
        }

        // Cannot rename `default` as in `import { default as foo } from "./someModule";
        if (isIdentifier(node) && node.originalKeywordKind === SyntaxKind.DefaultKeyword && symbol.parent!.flags & SymbolFlags.Module) {
            return undefined;
        }

        if (isStringLiteralLike(node) && tryGetImportFromModuleSpecifier(node)) {
            return getRenameInfoForModule(node, sourceFile, symbol);
        }

        const kind = SymbolDisplay.getSymbolKind(typeChecker, symbol, node);
        const specifierName = (isImportOrExportSpecifierName(node) || isStringOrNumericLiteralLike(node) && node.parent.kind === SyntaxKind.ComputedPropertyName)
            ? stripQuotes(getTextOfIdentifierOrLiteral(node))
            : undefined;
        const displayName = specifierName || typeChecker.symbolToString(symbol);
        const fullDisplayName = specifierName || typeChecker.getFullyQualifiedName(symbol);
        return getRenameInfoSuccess(displayName, fullDisplayName, kind, SymbolDisplay.getSymbolModifiers(symbol), node, sourceFile);
    }

    function getRenameInfoForModule(node: StringLiteralLike, sourceFile: SourceFile, moduleSymbol: Symbol): RenameInfo | undefined {
        const moduleSourceFile = find(moduleSymbol.declarations, isSourceFile);
        if (!moduleSourceFile) return undefined;
        const withoutIndex = node.text.endsWith("/index") || node.text.endsWith("/index.js") ? undefined : tryRemoveSuffix(removeFileExtension(moduleSourceFile.fileName), "/index");
        const name = withoutIndex === undefined ? moduleSourceFile.fileName : withoutIndex;
        const kind = withoutIndex === undefined ? ScriptElementKind.moduleElement : ScriptElementKind.directory;
        return {
            canRename: true,
            fileToRename: name,
            kind,
            displayName: name,
            localizedErrorMessage: undefined,
            fullDisplayName: name,
            kindModifiers: ScriptElementKindModifier.none,
            triggerSpan: createTriggerSpanForNode(node, sourceFile),
        };
    }

    function getRenameInfoSuccess(displayName: string, fullDisplayName: string, kind: ScriptElementKind, kindModifiers: string, node: Node, sourceFile: SourceFile): RenameInfo {
        return {
            canRename: true,
            fileToRename: undefined,
            kind,
            displayName,
            localizedErrorMessage: undefined,
            fullDisplayName,
            kindModifiers,
            triggerSpan: createTriggerSpanForNode(node, sourceFile)
        };
    }

    function getRenameInfoError(diagnostic: DiagnosticMessage): RenameInfo {
        // TODO: GH#18217
        return {
            canRename: false,
            localizedErrorMessage: getLocaleSpecificMessage(diagnostic),
            displayName: undefined!,
            fullDisplayName: undefined!,
            kind: undefined!,
            kindModifiers: undefined!,
            triggerSpan: undefined!
        };
    }

    function createTriggerSpanForNode(node: Node, sourceFile: SourceFile) {
        let start = node.getStart(sourceFile);
        let width = node.getWidth(sourceFile);
        if (node.kind === SyntaxKind.StringLiteral) {
            // Exclude the quotes
            start += 1;
            width -= 2;
        }
        return createTextSpan(start, width);
    }

    function nodeIsEligibleForRename(node: Node): boolean {
        switch (node.kind) {
            case SyntaxKind.Identifier:
            case SyntaxKind.StringLiteral:
            case SyntaxKind.ThisKeyword:
                return true;
            case SyntaxKind.NumericLiteral:
                return isLiteralNameOfPropertyDeclarationOrIndexAccess(node as NumericLiteral);
            default:
                return false;
        }
    }
}

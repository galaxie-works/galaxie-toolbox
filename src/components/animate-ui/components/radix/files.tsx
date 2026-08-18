import * as React from 'react';
import { ChevronRight, FolderIcon, FolderOpenIcon, FileIcon } from 'lucide-react';

import {
  Files as FilesPrimitive,
  FilesHighlight as FilesHighlightPrimitive,
  FolderItem as FolderItemPrimitive,
  FolderHeader as FolderHeaderPrimitive,
  FolderTrigger as FolderTriggerPrimitive,
  FolderHighlight as FolderHighlightPrimitive,
  Folder as FolderPrimitive,
  FolderIcon as FolderIconPrimitive,
  FileLabel as FileLabelPrimitive,
  FolderContent as FolderContentPrimitive,
  FileHighlight as FileHighlightPrimitive,
  File as FilePrimitive,
  FileIcon as FileIconPrimitive,
  useFolder,
  type FilesProps as FilesPrimitiveProps,
  type FolderItemProps as FolderItemPrimitiveProps,
  type FolderContentProps as FolderContentPrimitiveProps,
  type FileProps as FilePrimitiveProps,
  type FileLabelProps as FileLabelPrimitiveProps,
} from '@/components/animate-ui/primitives/radix/files';
import { cn } from '@/lib/utils';

// #991: chevron `>` que rotaciona ao abrir — é o ÚNICO gatilho de expandir/
// colapsar (o label passa a só navegar). Lê `isOpen` do FolderContext.
function FolderChevron() {
  const { isOpen } = useFolder();
  return (
    <ChevronRight
      className={cn(
        'size-4 shrink-0 text-muted-foreground transition-transform duration-150',
        isOpen && 'rotate-90',
      )}
    />
  );
}

type GitStatus = 'untracked' | 'modified' | 'deleted';

type FilesProps = FilesPrimitiveProps;

function Files({ className, children, ...props }: FilesProps) {
  return (
    <FilesPrimitive className={cn('p-2 w-full', className)} {...props}>
      <FilesHighlightPrimitive className="bg-accent rounded-lg pointer-events-none">
        {children}
      </FilesHighlightPrimitive>
    </FilesPrimitive>
  );
}

type SubFilesProps = FilesProps;

function SubFiles(props: SubFilesProps) {
  return <FilesPrimitive {...props} />;
}

type FolderItemProps = FolderItemPrimitiveProps;

function FolderItem(props: FolderItemProps) {
  return <FolderItemPrimitive {...props} />;
}

type FolderTriggerProps = FileLabelPrimitiveProps & {
  gitStatus?: GitStatus;
  // #869: ícone opcional que SUBSTITUI o ícone de pasta padrão (ex.: HardDrive
  // pra drives, Cloud pra mounts de nuvem). Aditivo/backward-compat: sem `icon`,
  // mantém o folder aberto/fechado animado. Quando setado, usa o MESMO ícone em
  // aberto/fechado (drive não "abre" visualmente), preservando o FolderIconPrimitive.
  icon?: React.ElementType;
  // #991: rótulo acessível do chevron (expandir/colapsar). Vem do dicionário do
  // consumidor (i18n) — sem ele o botão do chevron ficaria sem nome pro leitor.
  expandLabel?: string;
};

// #991 (correção do enunciado pelo Wagner, com prints do Windows): antes a LINHA
// INTEIRA era o gatilho do accordion e vinha envolta num container que navegava
// no mesmo clique → clicar uma pasta expandia E navegava, despejando as subpastas
// inline (duplicando a lista da direita). Agora, à moda do Windows Explorer:
//   • o CHEVRON é o único `AccordionTrigger` → expande/colapsa (stopPropagation
//     pra o clique não borbulhar pro container que navega);
//   • o ÍCONE+LABEL não são gatilho → o clique só navega (via container do
//     consumidor), deixando o nó COLAPSADO na árvore.
function FolderTrigger({
  children,
  className,
  gitStatus,
  icon: Icon,
  expandLabel,
  ...props
}: FolderTriggerProps) {
  return (
    <FolderHeaderPrimitive>
      <FolderHighlightPrimitive>
        <FolderPrimitive className="flex items-center justify-between gap-1 p-2">
          <div className="flex min-w-0 items-center gap-1">
            <FolderTriggerPrimitive
              aria-label={expandLabel}
              onClick={(e) => e.stopPropagation()}
              className="flex shrink-0 items-center rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <FolderChevron />
            </FolderTriggerPrimitive>
            <div
              className={cn(
                'flex min-w-0 items-center gap-2',
                gitStatus === 'untracked' && 'text-green-400',
                gitStatus === 'modified' && 'text-amber-400',
                gitStatus === 'deleted' && 'text-red-400',
              )}
            >
              {Icon ? (
                <FolderIconPrimitive
                  closeIcon={<Icon className="size-4.5" />}
                  openIcon={<Icon className="size-4.5" />}
                />
              ) : (
                <FolderIconPrimitive
                  closeIcon={<FolderIcon className="size-4.5" />}
                  openIcon={<FolderOpenIcon className="size-4.5" />}
                />
              )}
              <FileLabelPrimitive
                className={cn('truncate text-sm', className)}
                {...props}
              >
                {children}
              </FileLabelPrimitive>
            </div>
          </div>

          {gitStatus && (
            <span
              className={cn(
                'rounded-full size-2 shrink-0',
                gitStatus === 'untracked' && 'bg-green-400',
                gitStatus === 'modified' && 'bg-amber-400',
                gitStatus === 'deleted' && 'bg-red-400',
              )}
            />
          )}
        </FolderPrimitive>
      </FolderHighlightPrimitive>
    </FolderHeaderPrimitive>
  );
}

type FolderContentProps = FolderContentPrimitiveProps;

function FolderContent(props: FolderContentProps) {
  return (
    <div className="relative ml-6 before:absolute before:-left-2 before:inset-y-0 before:w-px before:h-full before:bg-border">
      <FolderContentPrimitive {...props} />
    </div>
  );
}

type FileItemProps = FilePrimitiveProps & {
  icon?: React.ElementType;
  gitStatus?: GitStatus;
};

function FileItem({
  icon: Icon = FileIcon,
  className,
  children,
  gitStatus,
  ...props
}: FileItemProps) {
  return (
    <FileHighlightPrimitive>
      <FilePrimitive
        className={cn(
          'flex items-center justify-between gap-2 p-2 pointer-events-none',
          gitStatus === 'untracked' && 'text-green-400',
          gitStatus === 'modified' && 'text-amber-400',
          gitStatus === 'deleted' && 'text-red-400',
        )}
      >
        <div className="flex items-center gap-2">
          <FileIconPrimitive>
            <Icon className="size-4.5" />
          </FileIconPrimitive>
          <FileLabelPrimitive className={cn('text-sm', className)} {...props}>
            {children}
          </FileLabelPrimitive>
        </div>

        {gitStatus && (
          <span className="text-sm font-medium">
            {gitStatus === 'untracked' && 'U'}
            {gitStatus === 'modified' && 'M'}
            {gitStatus === 'deleted' && 'D'}
          </span>
        )}
      </FilePrimitive>
    </FileHighlightPrimitive>
  );
}

export {
  Files,
  FolderItem,
  FolderTrigger,
  FolderContent,
  FileItem,
  SubFiles,
  type FilesProps,
  type FolderItemProps,
  type FolderTriggerProps,
  type FolderContentProps,
  type FileItemProps,
  type SubFilesProps,
};

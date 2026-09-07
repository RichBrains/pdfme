import type {
  SchemaForUI,
  Size,
  ChangeSchemas,
  BasePdf,
  Template,
  PageLayoutSettings,
} from '@pdfme/common';

export type SidebarProps = {
  height: number;
  hoveringSchemaId: string | null;
  onChangeHoveringSchemaId: (id: string | null) => void;
  size: Size;
  pageSize: Size;
  pageIndex: number;
  template: Template;
  onChangePageLayout: (
    pageIndex: number,
    update: (layout: PageLayoutSettings) => PageLayoutSettings,
  ) => void;
  basePdf: BasePdf;
  activeElements: HTMLElement[];
  schemas: SchemaForUI[];
  schemasList: SchemaForUI[][];
  onSortEnd: (sortedSchemas: SchemaForUI[]) => void;
  onEdit: (id: string) => void;
  onEditEnd: () => void;
  changeSchemas: ChangeSchemas;
  deselectSchema: () => void;
  sidebarOpen: boolean;
  setSidebarOpen: (sidebarOpen: boolean) => void;
};

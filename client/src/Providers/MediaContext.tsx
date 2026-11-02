import { createContext, useContext } from 'react';
import type { TAttachment } from 'librechat-data-provider';

type MediaContext = {
  /**
   * The turn's attachments, addressable by the filename a markdown image
   * names them with. A model that writes `![DTI](5_dti.png)` is referring to
   * a file the run produced, not to a path the browser can fetch, so the
   * markdown renderer resolves the reference through this map.
   */
  attachmentsByName?: ReadonlyMap<string, TAttachment>;
  /**
   * Every file the turn produced, by name, for markdown links: a model that
   * writes `[report](sandbox:/mnt/data/report.docx)` means that attachment.
   */
  filesByName?: ReadonlyMap<string, TAttachment>;
};

export const MediaContext = createContext<MediaContext>({});
export const useMediaContext = () => useContext(MediaContext);

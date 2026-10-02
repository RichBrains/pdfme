import React, { useContext, forwardRef, ReactNode, Ref, useEffect } from 'react';
import { Size } from '@pdfme/common';
import { FontContext } from '../contexts.js';
import { BACKGROUND_COLOR, DESIGNER_CLASSNAME } from '../constants.js';
import Spinner from './Spinner.js';

type Props = { size: Size; scale: number; children: ReactNode };

const Root = ({ size, scale, children }: Props, ref: Ref<HTMLDivElement>) => {
  const font = useContext(FontContext);

  useEffect(() => {
    if (!document || !document.fonts) return;
    const entries = Object.entries(font).map(([key, { data, hidden }]) => ({
      hidden: Boolean(hidden),
      fontFace: new FontFace(
        key,
        typeof data === 'string' ? `url(${data})` : (data as BufferSource),
        { display: 'swap' },
      ),
    }));
    // Hidden variant faces (bold/italic of a family) are registered without
    // loading: the browser fetches them only once styled text uses them.
    entries
      .filter(({ hidden, fontFace }) => hidden && !document.fonts.has(fontFace))
      .forEach(({ fontFace }) => document.fonts.add(fontFace));
    // The same variant faces are also registered as the family's bold/italic
    // styles, so CSS `font-weight: bold` in editors uses the real face.
    Object.entries(font).forEach(([family, { variants }]) => {
      const styled = [
        [variants?.bold, { weight: '700' }],
        [variants?.italic, { style: 'italic' }],
        [variants?.boldItalic, { weight: '700', style: 'italic' }],
      ] as const;
      styled.forEach(([variantName, descriptors]) => {
        const variant = variantName ? font[variantName] : undefined;
        if (!variant) return;
        const { data } = variant;
        document.fonts.add(
          new FontFace(family, typeof data === 'string' ? `url(${data})` : (data as BufferSource), {
            display: 'swap',
            ...descriptors,
          }),
        );
      });
    });
    const newFontFaces = entries
      .filter(({ hidden, fontFace }) => !hidden && !document.fonts.has(fontFace))
      .map(({ fontFace }) => fontFace);

    void Promise.allSettled(newFontFaces.map((f) => f.load())).then((loadedFontFaces) => {
      loadedFontFaces.forEach((loadedFontFace) => {
        if (loadedFontFace.status === 'fulfilled') {
          document.fonts.add(loadedFontFace.value);
        }
      });
    });
  }, [font]);

  return (
    <div
      className={DESIGNER_CLASSNAME + 'root'}
      ref={ref}
      style={{ position: 'relative', background: BACKGROUND_COLOR, ...size }}
    >
      <div className={DESIGNER_CLASSNAME + 'background'} style={{ margin: '0 auto', ...size }}>
        {scale === 0 ? <Spinner /> : children}
      </div>
    </div>
  );
};

export default forwardRef<HTMLDivElement, Props>(Root);

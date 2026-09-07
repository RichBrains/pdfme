import React, { Ref } from 'react';
import GuidesComponent from '@scena/react-guides';
import { ZOOM, Size } from '@pdfme/common';
import { RULER_HEIGHT } from '../../../constants.js';

const GuidesView = GuidesComponent as unknown as React.ElementType;

const guideStyle = (
  top: number,
  left: number,
  height: number,
  width: number,
): React.CSSProperties => ({
  position: 'absolute',
  top,
  left,
  height,
  width,
  background: '#333333',
});

const _Guides = ({
  paperSize,
  horizontalRef,
  verticalRef,
  horizontalGuides,
  verticalGuides,
  onChangeHorizontalGuides,
  onChangeVerticalGuides,
}: {
  paperSize: Size;
  horizontalRef: Ref<GuidesComponent> | undefined;
  verticalRef: Ref<GuidesComponent> | undefined;
  horizontalGuides: number[];
  verticalGuides: number[];
  onChangeHorizontalGuides: (guides: number[]) => void;
  onChangeVerticalGuides: (guides: number[]) => void;
}) => {
  return (
    <>
      <div
        className="ruler-container"
        style={guideStyle(-RULER_HEIGHT, -RULER_HEIGHT, RULER_HEIGHT, RULER_HEIGHT)}
      />
      <GuidesView
        zoom={ZOOM}
        style={guideStyle(-RULER_HEIGHT, 0, RULER_HEIGHT, paperSize.width)}
        type="horizontal"
        ref={horizontalRef}
        defaultGuides={horizontalGuides}
        onChangeGuides={({ guides }: { guides: number[] }) => onChangeHorizontalGuides(guides)}
      />
      <GuidesView
        zoom={ZOOM}
        style={guideStyle(0, -RULER_HEIGHT, paperSize.height, RULER_HEIGHT)}
        type="vertical"
        ref={verticalRef}
        defaultGuides={verticalGuides}
        onChangeGuides={({ guides }: { guides: number[] }) => onChangeVerticalGuides(guides)}
      />
    </>
  );
};

export default _Guides;

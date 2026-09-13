import React from 'react';

interface BrandLogoProps {
  className?: string;
  alt?: string;
}

const BrandLogo: React.FC<BrandLogoProps> = ({
  className = '',
  alt = 'Point2Wealth',
}) => (
  <img
    src="/logo.png"
    alt={alt}
    className={`block object-contain ${className}`}
    draggable={false}
  />
);

export default BrandLogo;

// One tile per damageable part: the percentage, coloured by severity, with a bar along the bottom.
import {memo} from 'react';
import {DMG_KEYS, dmgLevel} from '@shared';
import type {CarDamage} from '@shared';

export const DamageTiles = memo(function DamageTiles({damage}: {damage: CarDamage | null | undefined}) {
  return (
    <div className="dmg">
      {DMG_KEYS.map(([key, label]) => {
        const v = Math.round(damage?.[key] || 0);
        return (
          <div key={key} className={`dc l${dmgLevel(v)}`}>
            <span>{label}</span>
            <b>
              {v}
              <small>%</small>
            </b>
            <i className="dbar">
              <i style={{width: Math.min(100, v) + '%'}} />
            </i>
          </div>
        );
      })}
    </div>
  );
});

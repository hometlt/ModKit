package fixture;

/**
 * The caller-heap fixture: `javac --release 17 -d . Heap.java` (JDK 26.0.1) writes Heap.class.
 * A model's animation code reads fields, an array of parts and a static table of constants.
 */
public class Heap {
  private static final float[] ANGLES = {0.5F, 1.5F, 2.5F};
  public float age;
  public Part[] parts;

  public static final class Part {
    public float rotation;

    public void turn(float by) {
      rotation += by;
    }
  }

  public void animate(float time) {
    if (age > 1.0F) parts[0].turn(time);
    for (int i = 0; i < parts.length; i++) {
      parts[i].rotation = ANGLES[i] * time;
      parts[i].turn(ANGLES[i]);
    }
  }

  public void first(Part part) {
    if (parts[0] == part) part.turn(1.0F);
  }
}

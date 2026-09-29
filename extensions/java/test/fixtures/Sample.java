package fixture;

import java.util.ArrayList;
import java.util.List;

/** The class-file fixture: `javac --release 17 -d . Sample.java` (JDK 26.0.1) writes Sample.class. */
public class Sample {
  public static final int SIZE = 64;
  public static final String NAME = "sample";
  private final List<Part> parts = new ArrayList<>();

  public static final class Part {
    public final String name;
    public final float[] box;

    public Part(String name, float x, float y, float z, float w, float h, float d) {
      this.name = name;
      this.box = new float[] {x, y, z, w, h, d};
    }
  }

  public Sample add(Part part) {
    parts.add(part);
    return this;
  }

  public static Sample create() {
    return new Sample();
  }

  /** Straight-line builder code with constants, as a model definition is. */
  public static Sample body() {
    Sample sample = Sample.create();
    float offset = -3.0F;
    sample.add(new Part("head", -4.0F, -8.0F, -4.0F, 8.0F, 8.0F, 8.0F));
    sample.add(new Part("body", -4.0F, 0.0F, -2.0F, 8.0F, 12.0F, 4.0F))
        .add(new Part("arm", offset + 1.0F, -2.0F, -2.0F, 4, SIZE / 4, 4));
    return sample;
  }

  /** A loop over a constant bound: unrolls into three parts. */
  public static Sample rows(Sample sample) {
    for (int i = 0; i < 3; i++) sample.add(new Part("row", i, 0, 0, 1, 1, 1));
    return sample;
  }

  public static Runnable task() {
    return () -> System.out.println(NAME);
  }

  public static int loop(int n) {
    int total = 0;
    for (int i = 0; i < n; i++) total += i;
    return total;
  }

  public static String greet(String who) {
    return "hello " + who;
  }

  public static int guarded(String text) {
    try {
      return Integer.parseInt(text);
    } catch (NumberFormatException e) {
      return -1;
    }
  }

  public static long wide(long a, double b) {
    return a * 3L + (long) b;
  }

  public static int pick(int k) {
    switch (k) {
      case 1: return 10;
      case 5: return 50;
      case 100: return 1000;
      default: return 0;
    }
  }

  public static int dense(int k) {
    switch (k) {
      case 0: return 1;
      case 1: return 2;
      case 2: return 3;
      default: return 0;
    }
  }
}
